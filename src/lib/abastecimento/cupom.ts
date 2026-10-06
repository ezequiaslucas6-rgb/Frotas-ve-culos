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
  /** desconto impresso na linha do combustível (em reais, nunca a porcentagem) */
  desconto_item: number | null;
  /** valor líquido impresso na linha do combustível (já com desconto) */
  valor_liquido_item: number | null;
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

const litrosFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

type OrigemDesconto = 'item' | 'nota' | 'proporcional' | 'diferenca';

export function calcularCupom(l: LeituraCupom): CalculoCupom {
  const avisos: string[] = [];
  const conferencias: Conferencia[] = [];
  const preco = positivo(l.preco_unitario) ? l.preco_unitario : null;
  const liquidoItem = positivo(l.valor_liquido_item) ? l.valor_liquido_item : null;
  const descontoItem = l.desconto_item != null && l.desconto_item >= 0 ? l.desconto_item : null;
  const aPagar = !l.outros_itens && positivo(l.valor_a_pagar) ? l.valor_a_pagar : null;
  const acrescimo = !l.outros_itens && positivo(l.acrescimo_nota) ? l.acrescimo_nota : 0;
  /** o que o cupom diz que foi pago pelo combustível (para conferir as contas) */
  const liquidoImpresso = liquidoItem ?? (aPagar != null ? aPagar - acrescimo : null);
  const descontoImpresso = descontoItem ?? (!l.outros_itens && l.desconto_nota != null && l.desconto_nota > 0 ? l.desconto_nota : null);
  let litros = positivo(l.litros) ? l.litros : null;
  const tolerancia = (v: number) => Math.max(0.02, v * 0.002);

  // 1. valor do combustível antes do desconto
  let valorBruto: number | null = null;
  let brutoDeLitros = false;
  if (positivo(l.valor_item)) valorBruto = l.valor_item;
  else if (!l.outros_itens && positivo(l.valor_total_nota)) valorBruto = l.valor_total_nota;
  else if (liquidoItem && descontoItem != null) {
    valorBruto = arred2(liquidoItem + descontoItem);
    avisos.push('O valor total do combustível não aparece: calculado pelo valor líquido + desconto da linha.');
  }

  // 1a. a quantidade às vezes sai com ponto no lugar da vírgula ("5.413 LT" = 5,413 L)
  if (litros && preco && valorBruto && !perto(litros * preco, valorBruto, tolerancia(valorBruto))) {
    for (const divisor of [1000, 10_000]) {
      if (perto((litros / divisor) * preco, valorBruto, tolerancia(valorBruto))) {
        litros = arred3(litros / divisor);
        avisos.push(`Quantidade lida como ${litrosFmt.format(litros)} L: o cupom usa ponto no lugar da vírgula.`);
        break;
      }
    }
  }

  // 1b. DANFE: "valor total da nota" já é com desconto; o valor antes do desconto é o dos produtos
  if (valorBruto && litros && preco && descontoImpresso && liquidoImpresso && perto(valorBruto, liquidoImpresso, 0.02)) {
    const semDesconto = liquidoImpresso + descontoImpresso;
    if (perto(litros * preco, semDesconto, tolerancia(semDesconto))) {
      valorBruto = arred2(semDesconto);
      avisos.push('O valor total lido já era o valor com desconto: usado o valor antes do desconto (litros × preço da bomba).');
    }
  }

  if (!valorBruto && litros && preco) {
    valorBruto = arred2(litros * preco);
    brutoDeLitros = true;
    avisos.push('O valor total do combustível não aparece no cupom: calculado por litros × preço da bomba.');
  }

  // 2. desconto: o impresso que fecha com o valor líquido / a pagar; sem desconto impresso, a diferença
  const impressos: Array<{ valor: number; origem: OrigemDesconto }> = [];
  if (descontoItem != null) impressos.push({ valor: descontoItem, origem: 'item' });
  if (l.desconto_nota != null && l.desconto_nota >= 0) {
    if (!l.outros_itens) impressos.push({ valor: l.desconto_nota, origem: 'nota' });
    else if (valorBruto && positivo(l.valor_total_nota)) {
      impressos.push({ valor: arred2((l.desconto_nota * valorBruto) / l.valor_total_nota), origem: 'proporcional' });
    }
  }
  const fecha = (d: number) => valorBruto != null && liquidoImpresso != null && perto(valorBruto - d, liquidoImpresso, 0.02);
  let escolhido = liquidoImpresso != null ? impressos.find((c) => fecha(c.valor)) : undefined;
  if (escolhido && impressos[0] && escolhido !== impressos[0] && impressos[0].valor !== escolhido.valor) {
    avisos.push(`O desconto lido na linha (${brl(impressos[0].valor)}) não fecha com o valor pago: usado ${brl(escolhido.valor)}.`);
  }
  escolhido ??= impressos[0];
  if (!escolhido && valorBruto && liquidoImpresso != null && liquidoImpresso < valorBruto - 0.009) {
    escolhido = { valor: arred2(valorBruto - liquidoImpresso), origem: 'diferenca' };
    avisos.push('O desconto não aparece escrito: calculado pela diferença entre o valor total e o valor pago.');
  }
  if (escolhido?.origem === 'proporcional') {
    avisos.push('O desconto é da nota inteira (há outros produtos): foi dividido proporcionalmente ao valor do combustível.');
  }
  const desconto = escolhido?.valor ?? 0;

  let { valorLiquido, unitarioComDesconto, precoBomba: precoCalculado } = calcularValores({ litros, valorBruto, desconto });

  // sem preço da bomba para conferir: quantidade 1.000× maior aparece no preço por litro absurdo
  if (litros && !preco && unitarioComDesconto && unitarioComDesconto < PRECO_MIN && valorLiquido) {
    const corrigido = arred3(litros / 1000);
    const unit = valorLiquido / corrigido;
    if (unit >= PRECO_MIN && unit <= PRECO_MAX) {
      litros = corrigido;
      avisos.push(`Quantidade lida como ${litrosFmt.format(litros)} L: o cupom usa ponto no lugar da vírgula.`);
      ({ valorLiquido, unitarioComDesconto, precoBomba: precoCalculado } = calcularValores({ litros, valorBruto, desconto }));
    }
  }
  const precoBomba = preco ?? precoCalculado;

  // 3. conferências com os próprios números do cupom
  if (litros && preco && valorBruto && !brutoDeLitros) {
    const esperado = litros * preco;
    conferencias.push(
      perto(esperado, valorBruto, tolerancia(valorBruto))
        ? { ok: true, texto: 'Litros × preço da bomba = valor total' }
        : { ok: false, texto: `Litros × preço da bomba dá ${brl(arred2(esperado))}, mas o valor total lido é ${brl(valorBruto)}` },
    );
  }
  if (valorBruto && liquidoImpresso != null) {
    const esperado = valorBruto - desconto;
    const rotulo = liquidoItem ? 'valor líquido' : 'valor a pagar';
    conferencias.push(
      perto(esperado, liquidoImpresso, 0.02)
        ? { ok: true, texto: `Valor total − desconto = ${rotulo}` }
        : { ok: false, texto: `Valor total − desconto dá ${brl(arred2(esperado))}, mas o ${rotulo} lido é ${brl(liquidoImpresso)}` },
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

const placaLimpa = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Placa impressa no cupom (notas de convênio/frota) x veículo do lançamento. Diferente é sinal
 * de abastecimento de outro veículo (ou desvio): o resumo pede conferência.
 */
export function conferirPlaca(placaCupom: string | null, placaVeiculo: string): Conferencia | null {
  if (!placaCupom) return null;
  const cupom = placaLimpa(placaCupom);
  const veiculo = placaLimpa(placaVeiculo);
  return cupom === veiculo
    ? { ok: true, texto: `Placa do cupom = veículo escolhido (${veiculo})` }
    : { ok: false, texto: `A placa no cupom é ${cupom}, mas o veículo escolhido é ${veiculo}: confira se o abastecimento é deste veículo` };
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
/** desconto vem impresso com sinal ("-2,27"): vale o valor */
const valorDesconto = z
  .preprocess((v) => {
    if (v === '' || v == null) return null;
    const n = parseDecimalBR(v);
    return typeof n === 'number' && Number.isFinite(n) ? Math.abs(n) : n;
  }, z.number().finite().nonnegative().nullable())
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
  desconto_item: valorDesconto,
  valor_liquido_item: numero,
  valor_total_nota: numero,
  desconto_nota: valorDesconto,
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
  // placa só com letras e números, em maiúsculas ("RSV-2A77" -> "RSV2A77")
  placa: z
    .preprocess((v) => {
      const p = typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
      return p.length >= 6 && p.length <= 8 ? p : null;
    }, z.string().nullable())
    .catch(null),
  // "KM: 0" = não informado
  km: z
    .preprocess((v) => {
      const n = v === '' || v == null ? null : parseDecimalBR(v);
      return typeof n === 'number' && n > 0 ? n : null;
    }, z.number().int().positive().nullable())
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
