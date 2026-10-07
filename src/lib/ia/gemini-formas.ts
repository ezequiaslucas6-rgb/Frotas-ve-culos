/**
 * Jeitos de pedir a leitura ao Gemini, sem dependência do servidor (testável).
 *
 * O Google troca o modelo por trás de "gemini-flash-latest" sem aviso, e cada família aceita
 * ajustes diferentes. Os da família 3.x recusam (400) parte do que a 2.x aceitava:
 *  - "raciocínio": 2.x desliga com thinkingBudget 0; 3.x não desliga, só reduz
 *    (thinkingLevel "minimal" e, nos que não aceitam minimal, "low"); sem ajuste nenhum o
 *    modelo pensa no máximo e fica lento (pode estourar o tempo).
 *  - formato da resposta: responseSchema (OpenAPI, o original) virou legado; o atual é
 *    responseJsonSchema (JSON Schema). Em último caso, só "application/json" com o formato
 *    descrito no texto (a validação da resposta, em zod, é tolerante).
 * A forma é a combinação dos dois; quando o Google recusa, a mensagem diz qual dos dois mudar.
 */

export const AJUSTES_DE_PENSAMENTO: ReadonlyArray<Record<string, unknown>> = [
  { thinkingConfig: { thinkingBudget: 0 } },
  { thinkingConfig: { thinkingLevel: 'minimal' } },
  { thinkingConfig: { thinkingLevel: 'low' } },
  {},
];

export const FORMATOS_DE_RESPOSTA = ['responseSchema', 'responseJsonSchema', 'json'] as const;

export interface Forma {
  /** índice em AJUSTES_DE_PENSAMENTO */
  pensar: number;
  /** índice em FORMATOS_DE_RESPOSTA */
  formato: number;
}

const ULTIMO_PENSAR = AJUSTES_DE_PENSAMENTO.length - 1;
const ULTIMO_FORMATO = FORMATOS_DE_RESPOSTA.length - 1;

/** "thinkingBudget=0, responseSchema" (para o registro e a tela de teste). */
export function descreverForma(f: Forma): string {
  const t = AJUSTES_DE_PENSAMENTO[f.pensar]?.thinkingConfig as Record<string, unknown> | undefined;
  const pensar = t ? Object.entries(t).map(([k, v]) => `${k}=${v}`).join(',') : 'padrão';
  return `${pensar}, ${FORMATOS_DE_RESPOSTA[f.formato]}`;
}

/**
 * Próxima forma depois de um 400 com `mensagem`; null = não há mais o que tentar.
 * Mensagem sobre o raciocínio muda só o raciocínio; sobre o formato, só o formato.
 * Mensagem genérica ("Request contains an invalid argument"): primeiro o raciocínio (o que
 * mais muda entre modelos), depois o formato, recomeçando pelo raciocínio mais rápido.
 */
export function proximaForma(f: Forma, mensagem: string): Forma | null {
  const sobrePensar = /think/i.test(mensagem);
  const sobreFormato = !sobrePensar && /schema|nullable|enum|mime|response_?format|json/i.test(mensagem);
  if (sobreFormato && f.formato < ULTIMO_FORMATO) return { pensar: f.pensar, formato: f.formato + 1 };
  if (f.pensar < ULTIMO_PENSAR) return { pensar: f.pensar + 1, formato: f.formato };
  if (f.formato < ULTIMO_FORMATO) return { pensar: 0, formato: f.formato + 1 };
  return null;
}

/** Converte o schema OpenAPI do Gemini (type "OBJECT", nullable) em JSON Schema. */
export function paraJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(paraJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const { type, nullable, enum: valores, properties, items, ...resto } = s as Record<string, unknown>;
  const saida: Record<string, unknown> = { ...resto };
  if (typeof type === 'string') saida.type = nullable ? [type.toLowerCase(), 'null'] : type.toLowerCase();
  if (Array.isArray(valores)) saida.enum = nullable ? [...valores, null] : valores;
  if (properties && typeof properties === 'object') {
    saida.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, paraJsonSchema(v)]));
  }
  if (items) saida.items = paraJsonSchema(items);
  return saida;
}

/** Texto e generationConfig do pedido nesta forma. */
export function montarPedido(f: Forma, instrucoes: string, schema: Record<string, unknown>) {
  const formato = FORMATOS_DE_RESPOSTA[f.formato];
  const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json', ...AJUSTES_DE_PENSAMENTO[f.pensar] };
  let texto = instrucoes;
  if (formato === 'responseSchema') generationConfig.responseSchema = schema;
  else if (formato === 'responseJsonSchema') generationConfig.responseJsonSchema = paraJsonSchema(schema);
  else texto += `\n\nResponda somente com um objeto JSON neste formato (JSON Schema), com todos os campos:\n${JSON.stringify(paraJsonSchema(schema))}`;
  return { texto, generationConfig };
}
