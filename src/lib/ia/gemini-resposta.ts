/** Respostas e falhas da API do Gemini, sem dependência do servidor (testável). */

export type CodigoErroIA = 'sem_chave' | 'chave_invalida' | 'limite' | 'modelo' | 'regiao' | 'indisponivel' | 'recusado' | 'resposta_invalida';

export const MENSAGEM_ERRO_IA: Record<CodigoErroIA, string> = {
  sem_chave: 'A leitura automática do cupom não está ligada neste servidor.',
  chave_invalida: 'A chave do Gemini foi recusada. Confira GEMINI_API_KEY no .env do servidor.',
  limite: 'O limite gratuito da leitura automática foi atingido agora. Preencha os valores à mão; a leitura volta em alguns minutos.',
  modelo: 'O modelo do Gemini configurado não está disponível. Ajuste GEMINI_MODELOS no .env do servidor.',
  regiao: 'O Gemini não atende a região do servidor.',
  indisponivel: 'A leitura automática não respondeu agora. Preencha à mão ou tire a foto de novo.',
  recusado: 'O Gemini recusou o pedido de leitura. Preencha à mão; o detalhe aparece em Abastecimentos → Testar leitura de cupons.',
  resposta_invalida: 'Não foi possível entender a leitura do cupom. Confira a foto ou preencha à mão.',
};

export class ErroIA extends Error {
  constructor(
    readonly codigo: CodigoErroIA,
    readonly detalhe?: string,
  ) {
    super(MENSAGEM_ERRO_IA[codigo]);
    this.name = 'ErroIA';
  }
}

/** Status HTTP da API -> motivo (quem decide tentar o próximo modelo é quem chama). */
export function classificarFalha(status: number, corpo: string): ErroIA {
  const texto = corpo.slice(0, 500);
  if (status === 401 || (status === 403 && !/location|region/i.test(texto))) return new ErroIA('chave_invalida', texto);
  if (status === 400 && /api key not valid|API_KEY_INVALID/i.test(texto)) return new ErroIA('chave_invalida', texto);
  if (/location is not supported|FAILED_PRECONDITION.*(region|location)/i.test(texto)) return new ErroIA('regiao', texto);
  if (status === 429) return new ErroIA('limite', texto);
  if (status === 404) return new ErroIA('modelo', texto);
  if (status >= 500) return new ErroIA('indisponivel', texto);
  return new ErroIA('resposta_invalida', `${status} ${texto}`);
}

/** Início do detalhe quando a resposta passou do limite de tokens (quem chama tenta outro formato). */
export const RESPOSTA_CORTADA = 'resposta cortada (MAX_TOKENS)';

interface RespostaGemini {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/** Junta o texto da resposta (ignorando "pensamentos") e lê o JSON. */
export function extrairJson(corpo: unknown): unknown {
  const r = (corpo ?? {}) as RespostaGemini;
  if (r.promptFeedback?.blockReason) throw new ErroIA('resposta_invalida', `bloqueado: ${r.promptFeedback.blockReason}`);
  const candidato = r.candidates?.[0];
  const texto = (candidato?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()
    // alguns modelos ainda embrulham o JSON em ```json ... ```
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!texto) throw new ErroIA('resposta_invalida', `sem texto (${candidato?.finishReason ?? 'sem candidato'})`);
  try {
    return JSON.parse(texto);
  } catch {
    // o modo JSON às vezes "dispara" (espaços e quebras de linha sem fim) até bater no limite de tokens
    if (candidato?.finishReason === 'MAX_TOKENS') throw new ErroIA('resposta_invalida', `${RESPOSTA_CORTADA}: ${texto.slice(0, 120)}`);
    throw new ErroIA('resposta_invalida', `JSON inválido: ${texto.slice(0, 200)}`);
  }
}
