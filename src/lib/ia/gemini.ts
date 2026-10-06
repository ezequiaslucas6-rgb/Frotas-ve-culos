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
 * segundos (pensando, passa de 15 s). A resolução alta da imagem ajuda nos dígitos miúdos.
 * Modelo que não aceita estes ajustes (400) é chamado de novo sem eles, e fica anotado.
 */
const AJUSTES_RAPIDOS = { thinkingConfig: { thinkingBudget: 0 }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' } as const;
const semAjustes = new Set<string>();
const recusouAjustes = (status: number, corpo: string) =>
  status === 400 && /thinking|budget|media_?resolution|mediaResolution|Unknown name/i.test(corpo);

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
  for (const modelo of modelosGemini()) {
    const restante = TEMPO_TOTAL_MS - (Date.now() - inicio);
    if (restante < 3_000) break;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const comAjustes = !semAjustes.has(modelo);
      let resposta: Response;
      try {
        resposta = await fetch(`${urlBase()}/models/${encodeURIComponent(modelo)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: imagemBase64 } }, { text: instrucoes }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              ...(comAjustes ? AJUSTES_RAPIDOS : {}),
            },
          }),
          signal: AbortSignal.timeout(Math.min(TEMPO_POR_MODELO_MS, restante)),
          cache: 'no-store',
        });
      } catch {
        ultimo = new ErroIA('indisponivel', `${modelo}: sem resposta`);
        break;
      }
      if (!resposta.ok) {
        const corpo = await resposta.text().catch(() => '');
        if (comAjustes && recusouAjustes(resposta.status, corpo)) {
          semAjustes.add(modelo);
          console.warn(`[gemini] ${modelo}: sem os ajustes de velocidade (${corpo.slice(0, 120)})`);
          continue;
        }
        const erro = classificarFalha(resposta.status, corpo);
        if (erro.codigo === 'chave_invalida' || erro.codigo === 'regiao') throw erro; // outro modelo não resolve
        console.warn(`[gemini] ${modelo}: ${erro.codigo} (${resposta.status})`);
        ultimo = erro;
        break;
      }
      try {
        return { modelo, json: extrairJson(await resposta.json()), ms: Date.now() - inicio };
      } catch (e) {
        ultimo = e instanceof ErroIA ? e : new ErroIA('resposta_invalida');
        console.warn(`[gemini] ${modelo}: ${ultimo.detalhe ?? ultimo.codigo}`);
        break;
      }
    }
  }
  throw ultimo ?? new ErroIA('indisponivel');
}
