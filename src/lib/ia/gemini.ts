import 'server-only';
import { ErroIA, classificarFalha, extrairJson } from './gemini-resposta';
import { descreverForma, montarPedido, proximaForma, type Forma } from './gemini-formas';

/**
 * Gemini (Google AI Studio) pela API REST, só no servidor: a chave fica no .env da VPS
 * (GEMINI_API_KEY) e nunca vai para o celular.
 *
 * GEMINI_MODELOS: modelos em ordem de preferência, separados por vírgula. Se um não existir
 * mais, estourar o limite gratuito ou estiver fora do ar, tenta o próximo. Os "-latest"
 * acompanham sozinhos as versões novas do Google e entram sempre no fim da lista (um modelo
 * configurado que o Google desligou não deixa a leitura parada). O Flash vem antes do
 * Flash-Lite: lê melhor os dígitos miúdos (o Lite trocou 40,35 por 45,35 numa DANFE).
 */
const MODELOS_PADRAO = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

export const iaConfigurada = () => Boolean(process.env.GEMINI_API_KEY?.trim());

export const modelosGemini = () => {
  const configurados = (process.env.GEMINI_MODELOS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...configurados, ...MODELOS_PADRAO])];
};

// GEMINI_API_URL só existe para os testes (servidor simulado)
const urlBase = () => (process.env.GEMINI_API_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

/**
 * Cada modelo aceita um jeito de pedir (ver ./gemini-formas). A forma que deu certo fica
 * guardada por modelo: a busca (e o tempo que ela custa) só acontece na primeira leitura,
 * e de novo quando o Google troca o modelo por trás de um "-latest".
 */
const formaAceita = new Map<string, Forma>();
/** Só para os testes: esquece as formas aceitas. */
export const esquecerFormasAceitas = () => formaAceita.clear();

/** Tempo máximo por modelo e no total (a pessoa está esperando com o formulário aberto). */
const TEMPO_POR_MODELO_MS = 25_000;
const TEMPO_TOTAL_MS = 45_000;

/** Envia uma imagem com as instruções e devolve o JSON no formato pedido (`schema`, OpenAPI do Gemini). */
export async function gerarJsonDeImagem({
  imagemBase64,
  mimeType,
  instrucoes,
  schema,
}: {
  imagemBase64: string;
  mimeType: string;
  instrucoes: string;
  schema: Record<string, unknown>;
}): Promise<{ modelo: string; json: unknown; ms: number }> {
  const chave = process.env.GEMINI_API_KEY?.trim();
  if (!chave) throw new ErroIA('sem_chave');

  const inicio = Date.now();
  let ultimo: ErroIA | null = null;
  const motivos: string[] = [];
  for (const modelo of modelosGemini()) {
    let forma: Forma | null = formaAceita.get(modelo) ?? { pensar: 0, formato: 0 };
    while (forma) {
      const restante = TEMPO_TOTAL_MS - (Date.now() - inicio);
      if (restante < 3_000) break;
      const { texto, generationConfig } = montarPedido(forma, instrucoes, schema);
      let resposta: Response;
      try {
        resposta = await fetch(`${urlBase()}/models/${encodeURIComponent(modelo)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: imagemBase64 } }, { text: texto }] }],
            generationConfig,
          }),
          signal: AbortSignal.timeout(Math.min(TEMPO_POR_MODELO_MS, restante)),
          cache: 'no-store',
        });
      } catch {
        ultimo = new ErroIA('indisponivel', `${modelo}: sem resposta`);
        motivos.push(`${modelo} (${descreverForma(forma)}): sem resposta`);
        break;
      }
      if (!resposta.ok) {
        const corpo = await resposta.text().catch(() => '');
        const erro = classificarFalha(resposta.status, corpo);
        if (erro.codigo === 'chave_invalida' || erro.codigo === 'regiao') throw erro; // outro modelo não resolve
        const mensagem = resumirErro(corpo);
        const motivo = `${modelo} (${descreverForma(forma)}): ${resposta.status} ${mensagem}`;
        motivos.push(motivo);
        console.warn(`[gemini] ${motivo}`);
        // 400 = o modelo recusou algo do pedido: tenta a próxima forma, guiada pela mensagem do Google
        const proxima: Forma | null = resposta.status === 400 ? proximaForma(forma, mensagem) : null;
        if (proxima) {
          forma = proxima;
          continue;
        }
        formaAceita.delete(modelo);
        ultimo = new ErroIA(erro.codigo === 'resposta_invalida' ? 'recusado' : erro.codigo, motivos.join(' | '));
        break;
      }
      formaAceita.set(modelo, forma);
      try {
        return { modelo, json: extrairJson(await resposta.json()), ms: Date.now() - inicio };
      } catch (e) {
        ultimo = e instanceof ErroIA ? e : new ErroIA('resposta_invalida');
        motivos.push(`${modelo}: ${ultimo.detalhe ?? ultimo.codigo}`);
        console.warn(`[gemini] ${modelo}: ${ultimo.detalhe ?? ultimo.codigo}`);
        break;
      }
    }
  }
  if (ultimo && motivos.length) throw new ErroIA(ultimo.codigo, motivos.join(' | '));
  throw ultimo ?? new ErroIA('indisponivel', 'tempo esgotado');
}

/** A mensagem do Google, curta (vai para o registro do servidor e para a tela de teste). */
function resumirErro(corpo: string): string {
  try {
    const j = JSON.parse(corpo) as { error?: { message?: string; status?: string } };
    if (j.error?.message) return `${j.error.status ?? ''} ${j.error.message}`.trim().slice(0, 300);
  } catch {
    /* não é JSON */
  }
  return corpo.slice(0, 300);
}
