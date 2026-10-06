/**
 * Valores do abastecimento a partir do cupom (nota de abastecimento).
 *
 * O cupom mostra o preço da bomba, o valor total e o desconto, mas não o preço por litro
 * COM desconto. A leitura da foto (IA) só transcreve os números impressos; as contas são
 * feitas aqui, sempre do mesmo jeito, e conferidas com os próprios números do cupom:
 *   valor líquido          = valor total − desconto   (é o que foi pago)
 *   unitário com desconto  = valor líquido ÷ litros
 *   conferências           litros × preço da bomba = valor total; total − desconto = valor a pagar
 */
import { z } from 'zod';
import { COMBUSTIVEIS, parseDecimalBR, type Combustivel } from './consumo';

/** O que a IA transcreveu do cupom (null = não aparece ou não dá para ler). */
export interface LeituraCupom {
  /** é um comprovante de abastecimento e os números estão legíveis */
  legivel: boolean;
  combustivel: Combustivel | 'outro' | null;
  /** descrição do produto como impressa (ex.: "GASOLINA C COMUM") */
  produto: string | null;
  litros: number | null;
  /** preço por litro impresso (o da bomba, sem desconto) */
  preco_unitario: number | null;
  /** valor do item combustível, antes do desconto */
  valor_item: number | null;
  /** desconto impresso na linha do combustível */
  desconto_item: number | null;
  /** totais da nota inteira */
  valor_total_nota: number | null;
  desconto_nota: number | null;
  acrescimo_nota: number | null;
  valor_a_pagar: number | null;
  /** a nota tem outros produtos além do combustível (ARLA, óleo, loja…) */
  outros_itens: boolean;
  /** data de emissão, AAAA-MM-DD */
  data: string | null;
  posto: string | null;
  cnpj: string | null;
  placa: string | null;
  km: number | null;
  /** o que a IA achou duvidoso */
  observacao: string | null;
}

export interface Conferencia {
  ok: boolean;
  texto: string;
}

export interface CalculoCupom {
  litros: number | null;
  /** valor total do combustível, antes do desconto */
  valorBruto: number | null;
  desconto: number;
  /** como impresso no cupom */
  valorAPagar: number | null;
  /** valor total − desconto: o que foi pago pelo combustível */
  valorLiquido: number | null;
  unitarioComDesconto: number | null;
  precoBomba: number | null;
  conferencias: Conferencia[];
  avisos: string[];
  /** tudo foi lido e as conferências batem */
  confiavel: boolean;
}

export const arred2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const arred3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v: number) => moeda.format(v);

/** Preço por litro fora disso é quase sempre leitura ou digitação errada. */
const PRECO_MIN = 1.5;
const PRECO_MAX = 15;

/** As contas, valendo também para o lançamento digitado à mão. */
export function calcularValores({ litros, valorBruto, desconto }: { litros?: number | null; valorBruto?: number | null; desconto?: number | null }) {
  const d = desconto && desconto > 0 ? arred2(desconto) : 0;
  const valorLiquido = valorBruto != null && valorBruto > 0 ? arred2(valorBruto - d) : null;
  const ok = litros != null && litros > 0;
  return {
    desconto: d,
    valorLiquido,
    unitarioComDesconto: ok && valorLiquido != null && valorLiquido > 0 ? arred3(valorLiquido / litros) : null,
    precoBomba: ok && valorBruto != null && valorBruto > 0 ? arred3(valorBruto / litros) : null,
  };
}

const perto = (a: number, b: number, tolerancia: number) => Math.abs(a - b) <= tolerancia + 1e-9;
const positivo = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

export function calcularCupom(l: LeituraCupom): CalculoCupom {
  const avisos: string[] = [];
  const conferencias: Conferencia[] = [];
  const litros = positivo(l.litros) ? l.litros : null;

  // valor do combustível antes do desconto
  let valorBruto: number | null = null;
  const brutoLido = positivo(l.valor_item) || (!l.outros_itens && positivo(l.valor_total_nota));
  if (positivo(l.valor_item)) valorBruto = l.valor_item;
  else if (!l.outros_itens && positivo(l.valor_total_nota)) valorBruto = l.valor_total_nota;
  else if (litros && positivo(l.preco_unitario)) {
    valorBruto = arred2(litros * l.preco_unitario);
    avisos.push('O valor total do combustível não aparece no cupom: calculado por litros × preço da bomba.');
  }

  // desconto do combustível
  let desconto = 0;
  if (l.desconto_item != null && l.desconto_item >= 0) {
    desconto = l.desconto_item;
  } else if (l.desconto_nota != null && l.desconto_nota > 0) {
    if (!l.outros_itens) desconto = l.desconto_nota;
    else if (valorBruto && positivo(l.valor_total_nota)) {
      desconto = arred2((l.desconto_nota * valorBruto) / l.valor_total_nota);
      avisos.push('O desconto é da nota inteira (há outros produtos): foi dividido proporcionalmente ao valor do combustível.');
    }
  } else if (!l.outros_itens && valorBruto && positivo(l.valor_a_pagar) && l.valor_a_pagar < valorBruto - 0.009 && !positivo(l.acrescimo_nota)) {
    desconto = arred2(valorBruto - l.valor_a_pagar);
    avisos.push('O desconto não aparece escrito: calculado pela diferença entre o valor total e o valor a pagar.');
  }

  const { valorLiquido, unitarioComDesconto, precoBomba: precoCalculado } = calcularValores({ litros, valorBruto, desconto });
  const precoBomba = positivo(l.preco_unitario) ? l.preco_unitario : precoCalculado;

  // conferência 1: litros × preço da bomba = valor total (a nota arredonda/trunca o item em centavos)
  if (litros && positivo(l.preco_unitario) && valorBruto && brutoLido) {
    const esperado = litros * l.preco_unitario;
    conferencias.push(
      perto(esperado, valorBruto, Math.max(0.02, valorBruto * 0.002))
        ? { ok: true, texto: 'Litros × preço da bomba = valor total' }
        : { ok: false, texto: `Litros × preço da bomba dá ${brl(arred2(esperado))}, mas o valor total lido é ${brl(valorBruto)}` },
    );
  }

  // conferência 2: valor total − desconto (+ acréscimo) = valor a pagar
  if (!l.outros_itens && valorBruto && positivo(l.valor_a_pagar)) {
    const esperado = valorBruto - desconto + (positivo(l.acrescimo_nota) ? l.acrescimo_nota : 0);
    conferencias.push(
      perto(esperado, l.valor_a_pagar, 0.02)
        ? { ok: true, texto: 'Valor total − desconto = valor a pagar' }
        : { ok: false, texto: `Valor total − desconto dá ${brl(arred2(esperado))}, mas o valor a pagar lido é ${brl(l.valor_a_pagar)}` },
    );
  }

  if (!l.legivel) avisos.unshift('A foto não parece um cupom de abastecimento legível. Tire outra foto ou preencha à mão.');
  if (!litros) avisos.push('Não foi possível ler a quantidade de litros.');
  if (!valorBruto) avisos.push('Não foi possível ler o valor total.');
  if (valorBruto && desconto >= valorBruto) avisos.push('O desconto lido é maior que o valor total: confira.');
  if (l.outros_itens) avisos.push('O cupom tem outros produtos além do combustível: confira se os valores são só do combustível.');
  if (unitarioComDesconto && (unitarioComDesconto < PRECO_MIN || unitarioComDesconto > PRECO_MAX)) {
    avisos.push(`Preço por litro fora do comum (${brl(unitarioComDesconto)}): confira os litros e o valor.`);
  }
  if (l.observacao?.trim()) avisos.push(`Observação da leitura: ${l.observacao.trim()}`);

  return {
    litros,
    valorBruto,
    desconto,
    valorAPagar: positivo(l.valor_a_pagar) ? l.valor_a_pagar : null,
    valorLiquido,
    unitarioComDesconto,
    precoBomba,
    conferencias,
    avisos,
    confiavel: l.legivel && litros != null && valorBruto != null && conferencias.length > 0 && conferencias.every((c) => c.ok) && desconto < valorBruto,
  };
}

/** Número no formato dos campos do formulário ("45,320"). */
export const paraCampo = (v: number, casas = 2) => v.toFixed(casas).replace('.', ',');

export const COMBUSTIVEIS_CUPOM = [...COMBUSTIVEIS.map((c) => c.value), 'outro'] as const;

/* ------------------------------------------------------------------------------------------
 * Validação da leitura (resposta da IA e campo escondido do formulário). Tolerante: número em
 * texto ("45,320") vira número, campo faltando ou estranho vira null; nunca derruba a leitura.
 * ---------------------------------------------------------------------------------------- */
const numero = z
  .preprocess((v) => (v === '' || v == null ? null : parseDecimalBR(v)), z.number().finite().nonnegative().nullable())
  .catch(null);
const texto = (max: number) =>
  z
    .preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null), z.string().nullable())
    .catch(null);

export const leituraCupomSchema = z.object({
  legivel: z.boolean().catch(false),
  combustivel: z.enum(COMBUSTIVEIS_CUPOM).nullable().catch(null),
  produto: texto(120),
  litros: numero,
  preco_unitario: numero,
  valor_item: numero,
  desconto_item: numero,
  valor_total_nota: numero,
  desconto_nota: numero,
  acrescimo_nota: numero,
  valor_a_pagar: numero,
  outros_itens: z.boolean().catch(false),
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  posto: texto(120),
  cnpj: texto(20),
  placa: texto(10),
  km: z
    .preprocess((v) => (v === '' || v == null ? null : parseDecimalBR(v)), z.number().int().nonnegative().nullable())
    .catch(null),
  observacao: texto(300),
}) satisfies z.ZodType<LeituraCupom>;

/** O que fica gravado no lançamento (conferência): a leitura e de onde ela veio. */
export const registroLeituraSchema = z.object({
  modelo: z.string().max(80),
  lido_em: z.string().max(40),
  leitura: leituraCupomSchema,
});
export type RegistroLeitura = z.infer<typeof registroLeituraSchema>;
