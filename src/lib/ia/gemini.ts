import 'server-only';
import { ErroIA, classificarFalha, extrairJson } from './gemini-resposta';

/**
 * Gemini (Google AI Studio) pela API REST, só no servidor: a chave fica no .env da VPS
 * (GEMINI_API_KEY) e nunca vai para o celular.
 *
 * GEMINI_MODELOS: modelos em ordem de preferência, separados por vírgula. Se um não existir
 * mais, estourar o limite gratuito ou estiver fora do ar, tenta o próximo. Os "-latest"
 * acompanham sozinhos as versões novas do Google. O Flash vem antes do Flash-Lite: lê melhor
 * os dígitos miúdos (o Lite trocou 40,35 por 45,35 numa DANFE) e, sem "pensar", é rápido.
 */
const MODELOS_PADRAO = 'gemini-flash-latest,gemini-flash-lite-latest';

export const iaConfigurada = () => Boolean(process.env.GEMINI_API_KEY?.trim());

export const modelosGemini = () =>
  (process.env.GEMINI_MODELOS?.trim() || MODELOS_PADRAO)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

// GEMINI_API_URL só existe para os testes (servidor simulado)
const urlBase = () => (process.env.GEMINI_API_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

/**
 * Leitura de foto pede rapidez, não raciocínio: sem "pensar" o modelo responde em poucos
 * segundos (pensando, passa de 15 s). Cada família de modelo desliga o raciocínio de um
 * jeito (2.x: thinkingBudget 0; 3.x: thinkingLevel "minimal") e alguns não deixam. Por isso
 * a chamada tenta as formas em ordem e, se o Google recusar (400), passa para a próxima; a
 * última é a chamada simples, sem ajuste nenhum (a que sempre funcionou). A forma aceita
 * por cada modelo fica guardada, então a recusa só custa tempo na primeira leitura.
 */
export const FORMAS_DE_CHAMADA: ReadonlyArray<Record<string, unknown>> = [
  { thinkingConfig: { thinkingBudget: 0 } },
  { thinkingConfig: { thinkingLevel: 'minimal' } },
  {},
];
const formaAceita = new Map<string, number>();
/** Só para os testes: esquece as formas aceitas. */
export const esquecerFormasAceitas = () => formaAceita.clear();

/** Tempo máximo por modelo e no total (a pessoa está esperando com o formulário aberto). */
const TEMPO_POR_MODELO_MS = 25_000;
const TEMPO_TOTAL_MS = 40_000;

/** Envia uma imagem com as instruções e devolve o JSON no formato pedido (`schema`). */
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
    for (let forma = formaAceita.get(modelo) ?? 0; forma < FORMAS_DE_CHAMADA.length; forma++) {
      const restante = TEMPO_TOTAL_MS - (Date.now() - inicio);
      if (restante < 3_000) break;
      let resposta: Response;
      try {
        resposta = await fetch(`${urlBase()}/models/${encodeURIComponent(modelo)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: imagemBase64 } }, { text: instrucoes }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: schema, ...FORMAS_DE_CHAMADA[forma] },
          }),
          signal: AbortSignal.timeout(Math.min(TEMPO_POR_MODELO_MS, restante)),
          cache: 'no-store',
        });
      } catch {
        ultimo = new ErroIA('indisponivel', `${modelo}: sem resposta`);
        motivos.push(`${modelo}: sem resposta`);
        break;
      }
      if (!resposta.ok) {
        const corpo = await resposta.text().catch(() => '');
        const erro = classificarFalha(resposta.status, corpo);
        if (erro.codigo === 'chave_invalida' || erro.codigo === 'regiao') throw erro; // outro modelo não resolve
        const motivo = `${modelo} (forma ${forma + 1}): ${resposta.status} ${resumirErro(corpo)}`;
        motivos.push(motivo);
        console.warn(`[gemini] ${motivo}`);
        // 400 = o modelo recusou o pedido (ex.: um ajuste que ele não aceita): tenta a próxima forma
        if (resposta.status === 400 && forma < FORMAS_DE_CHAMADA.length - 1) continue;
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
