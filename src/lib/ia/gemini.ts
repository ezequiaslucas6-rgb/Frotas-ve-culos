import 'server-only';
import { ErroIA, classificarFalha, extrairJson } from './gemini-resposta';

/**
 * Gemini (Google AI Studio) pela API REST, só no servidor: a chave fica no .env da VPS
 * (GEMINI_API_KEY) e nunca vai para o celular.
 *
 * GEMINI_MODELOS: modelos em ordem de preferência, separados por vírgula. Se um não existir
 * mais, estourar o limite gratuito ou estiver fora do ar, tenta o próximo. Os "-latest"
 * acompanham sozinhos as versões novas do Google.
 */
const MODELOS_PADRAO = 'gemini-flash-lite-latest,gemini-flash-latest';

export const iaConfigurada = () => Boolean(process.env.GEMINI_API_KEY?.trim());

export const modelosGemini = () =>
  (process.env.GEMINI_MODELOS?.trim() || MODELOS_PADRAO)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

// GEMINI_API_URL só existe para os testes (servidor simulado)
const urlBase = () => (process.env.GEMINI_API_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

/** Envia uma imagem com as instruções e devolve o JSON no formato pedido (`schema`). */
export async function gerarJsonDeImagem({
  imagemBase64,
  mimeType,
  instrucoes,
  schema,
  timeoutMs = 45_000,
}: {
  imagemBase64: string;
  mimeType: string;
  instrucoes: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ modelo: string; json: unknown }> {
  const chave = process.env.GEMINI_API_KEY?.trim();
  if (!chave) throw new ErroIA('sem_chave');

  let ultimo: ErroIA | null = null;
  for (const modelo of modelosGemini()) {
    let resposta: Response;
    try {
      resposta = await fetch(`${urlBase()}/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: imagemBase64 } }, { text: instrucoes }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
        }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch {
      ultimo = new ErroIA('indisponivel', `${modelo}: sem resposta`);
      continue;
    }
    if (!resposta.ok) {
      const erro = classificarFalha(resposta.status, await resposta.text().catch(() => ''));
      if (erro.codigo === 'chave_invalida' || erro.codigo === 'regiao') throw erro; // outro modelo não resolve
      console.warn(`[gemini] ${modelo}: ${erro.codigo} (${resposta.status})`);
      ultimo = erro;
      continue;
    }
    try {
      return { modelo, json: extrairJson(await resposta.json()) };
    } catch (e) {
      ultimo = e instanceof ErroIA ? e : new ErroIA('resposta_invalida');
      console.warn(`[gemini] ${modelo}: ${ultimo.detalhe ?? ultimo.codigo}`);
    }
  }
  throw ultimo ?? new ErroIA('indisponivel');
}
