import 'server-only';
import { ErroIA, classificarFalha, extrairJson } from './gemini-resposta';
import { descreverForma, montarPedido, proximaForma, type Forma } from './gemini-formas';

/**
 * Gemini (Google AI Studio) pela API REST, só no servidor: a chave fica no .env da VPS
 * (GEMINI_API_KEY) e nunca vai para o celular.
 *
 * GEMINI_MODELOS: modelos em ordem de preferência, separados por vírgula. Se um não existir
 * mais, estourar o limite gratuito, estiver fora do ar ou demorar, entra o próximo. Os
 * "-latest" acompanham sozinhos as versões novas do Google e entram sempre no fim da lista
 * (um modelo configurado que o Google desligou não deixa a leitura parada). O Flash vem antes
 * do Flash-Lite: lê melhor os dígitos miúdos (o Lite trocou 40,35 por 45,35 numa DANFE).
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

/** Tempo máximo da leitura (a pessoa está esperando com o formulário aberto; o Nginx corta em 60 s). */
const TEMPO_TOTAL_MS = 45_000;
/**
 * Se o modelo não respondeu nesse tempo, o próximo começa em paralelo e vale a primeira
 * resposta (o gemini-flash-latest às vezes passa de 25 s; esperar por ele estourava o tempo).
 */
export const ESPERA_ANTES_DO_RESERVA_MS = 10_000;

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
  const modelos = modelosGemini();
  const encerrar = new AbortController(); // um modelo respondeu: cancela os outros
  const prazo = AbortSignal.any([encerrar.signal, AbortSignal.timeout(TEMPO_TOTAL_MS)]);
  const motivos: string[] = [];
  const pedido = { chave, imagemBase64, mimeType, instrucoes, schema, prazo, cancelado: encerrar.signal, motivos, inicio };

  return new Promise((resolve, reject) => {
    let proximo = 0;
    let ativos = 0;
    let terminou = false;
    let ultimo: ErroIA | null = null;
    let reserva: ReturnType<typeof setTimeout> | undefined;

    const terminar = () => {
      terminou = true;
      clearTimeout(reserva);
      encerrar.abort();
    };
    const iniciar = () => {
      clearTimeout(reserva);
      if (terminou) return;
      if (proximo >= modelos.length) {
        if (ativos === 0) {
          terminar();
          reject(new ErroIA(ultimo?.codigo ?? 'indisponivel', motivos.join(' | ') || 'tempo esgotado'));
        }
        return;
      }
      const modelo = modelos[proximo++]!;
      ativos++;
      lerComModelo(modelo, pedido).then(
        (json) => {
          if (terminou) return;
          terminar();
          resolve({ modelo, json, ms: Date.now() - inicio });
        },
        (e: unknown) => {
          ativos--;
          if (terminou) return;
          const erro = e instanceof ErroIA ? e : new ErroIA('indisponivel', String(e));
          if (erro.codigo === 'chave_invalida' || erro.codigo === 'regiao') {
            terminar(); // outro modelo não resolve
            reject(erro);
            return;
          }
          ultimo = erro;
          iniciar(); // falhou: o próximo entra na hora
        },
      );
      if (proximo < modelos.length) {
        reserva = setTimeout(() => {
          console.warn(`[gemini] ${modelo} sem resposta em ${ESPERA_ANTES_DO_RESERVA_MS / 1000} s: ${modelos[proximo]} começa em paralelo`);
          iniciar();
        }, ESPERA_ANTES_DO_RESERVA_MS);
      }
    };
    iniciar();
  });
}

/** Lê com um modelo, procurando a forma de pedir que ele aceita. Erro = esse modelo não serve agora. */
async function lerComModelo(
  modelo: string,
  p: { chave: string; imagemBase64: string; mimeType: string; instrucoes: string; schema: Record<string, unknown>; prazo: AbortSignal; cancelado: AbortSignal; motivos: string[]; inicio: number },
): Promise<unknown> {
  const anotar = (motivo: string) => {
    if (p.cancelado.aborted) return; // outro modelo já respondeu
    p.motivos.push(motivo);
    console.warn(`[gemini] ${motivo}`);
  };
  let forma: Forma = formaAceita.get(modelo) ?? { pensar: 0, formato: 0 };
  for (;;) {
    const { texto, generationConfig } = montarPedido(forma, p.instrucoes, p.schema);
    let resposta: Response;
    try {
      resposta = await fetch(`${urlBase()}/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': p.chave },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: p.mimeType, data: p.imagemBase64 } }, { text: texto }] }],
          generationConfig,
        }),
        signal: p.prazo,
        cache: 'no-store',
      });
    } catch {
      anotar(`${modelo} (${descreverForma(forma)}): sem resposta`);
      throw new ErroIA('indisponivel');
    }
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      const erro = classificarFalha(resposta.status, corpo);
      if (erro.codigo === 'chave_invalida' || erro.codigo === 'regiao') throw erro;
      const mensagem = resumirErro(corpo);
      anotar(`${modelo} (${descreverForma(forma)}): ${resposta.status} ${mensagem}`);
      // 400 = o modelo recusou algo do pedido: tenta a próxima forma, guiada pela mensagem do Google
      const proxima = resposta.status === 400 ? proximaForma(forma, mensagem) : null;
      if (proxima && !p.prazo.aborted) {
        forma = proxima;
        continue;
      }
      formaAceita.delete(modelo);
      throw new ErroIA(erro.codigo === 'resposta_invalida' ? 'recusado' : erro.codigo);
    }
    formaAceita.set(modelo, forma);
    try {
      const json = extrairJson(await resposta.json());
      console.info(`[gemini] ${modelo} (${descreverForma(forma)}): lido em ${((Date.now() - p.inicio) / 1000).toFixed(1)} s`);
      return json;
    } catch (e) {
      const erro = e instanceof ErroIA ? e : new ErroIA('resposta_invalida');
      anotar(`${modelo}: ${erro.detalhe ?? erro.codigo}`);
      throw erro;
    }
  }
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
