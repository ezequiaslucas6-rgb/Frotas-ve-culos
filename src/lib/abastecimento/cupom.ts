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

/** Campo do cupom que a conferência cruzada pode corrigir. */
export type CampoCorrigivel = 'litros' | 'preco' | 'valorBruto' | 'desconto' | 'liquido';

/** Número lido errado (um dígito) e corrigido porque só a correção fecha as contas do próprio cupom. */
export interface Correcao {
  campo: CampoCorrigivel;
  lido: number;
  corrigido: number;
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
  /** números corrigidos pela conferência cruzada (a tela destaca para a pessoa conferir na foto) */
  correcoes: Correcao[];
  /** tudo foi lido, as conferências batem e nada precisou ser corrigido */
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
/** litros × preço pode diferir do total pelo arredondamento do preço impresso */
const toleranciaTotal = (v: number) => Math.max(0.02, v * 0.002);
/** total − desconto e o valor pago impresso: só o arredondamento dos centavos */
const TOLERANCIA_PAGO = 0.02;
/** para corrigir um dígito, litros × preço tem de dar o total no centavo (arredondamento) */
const TOLERANCIA_CORRECAO = 0.015;

const litrosFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

type OrigemDesconto = 'item' | 'nota' | 'proporcional' | 'diferenca';

/** Casas decimais com que o número foi lido (no mínimo `minimo`, no máximo 4). */
const casasDe = (v: number, minimo: number) => {
  const s = String(v);
  const i = s.indexOf('.');
  return Math.max(minimo, i < 0 ? 0 : Math.min(4, s.length - i - 1));
};

/**
 * Números que a leitura pode ter confundido com `v`: um dígito trocado (o 0 lido como 5,
 * o 1 como 7…) ou dois dígitos vizinhos invertidos. Mantém as casas decimais.
 */
export function variantesDeUmDigito(v: number, minimoCasas = 2): number[] {
  const s = v.toFixed(casasDe(v, minimoCasas));
  const saida = new Set<number>();
  const aceita = (t: string) => {
    if (!/^0\d/.test(t)) saida.add(Number(t)); // sem zero à esquerda ("05,35")
  };
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '.') continue;
    for (const d of '0123456789') if (d !== s[i]) aceita(s.slice(0, i) + d + s.slice(i + 1));
    const j = i + 1;
    if (j < s.length && s[j] !== '.' && s[j] !== s[i]) aceita(s.slice(0, i) + s[j] + s[i] + s.slice(j + 1));
  }
  saida.delete(v);
  return [...saida].filter((n) => n > 0);
}

interface Contas {
  litros: number | null;
  preco: number | null;
  valorBruto: number | null;
  desconto: number;
  /** valor pago impresso (líquido da linha ou valor a pagar) */
  liquido: number | null;
}

/** Quanto cada conta do cupom erra (null = não dá para conferir). */
function erros(c: Contas, conferirLitros: boolean) {
  return {
    total: conferirLitros && c.litros && c.preco && c.valorBruto ? Math.abs(c.litros * c.preco - c.valorBruto) : null,
    pago: c.valorBruto != null && c.liquido != null ? Math.abs(c.valorBruto - c.desconto - c.liquido) : null,
  };
}

/**
 * As contas fecham? `exato` (para corrigir um número): litros × preço tem de dar o total no
 * centavo; sem isso, uma correção "quase certa" poderia trocar o número certo pelo errado.
 */
function fecham(c: Contas, conferirLitros: boolean, exato = false) {
  const e = erros(c, conferirLitros);
  const limiteTotal = exato ? TOLERANCIA_CORRECAO : toleranciaTotal(c.valorBruto!);
  return (e.total == null || e.total <= limiteTotal + 1e-9) && (e.pago == null || e.pago <= TOLERANCIA_PAGO + 1e-9);
}

const CAMPOS: ReadonlyArray<[CampoCorrigivel, keyof Contas]> = [
  ['litros', 'litros'],
  ['preco', 'preco'],
  ['valorBruto', 'valorBruto'],
  ['desconto', 'desconto'],
  ['liquido', 'liquido'],
];

/**
 * Conferência cruzada: o cupom tem números redundantes (litros × preço = total; total −
 * desconto = valor pago). Se as contas não fecham, procura UM número lido com um dígito
 * errado cuja correção faz todas fecharem. Só corrige quando essa correção é a única: se
 * mais de um número poderia estar errado, não adivinha (`ambiguo`) e a pessoa confere.
 * Campos `fixos` (impressos duas vezes iguais, ou calculados) nunca são trocados.
 */
export function corrigirUmDigito(
  c: Contas,
  { conferirLitros = true, fixos = new Set<CampoCorrigivel>() }: { conferirLitros?: boolean; fixos?: ReadonlySet<CampoCorrigivel> } = {},
): { correcao: Correcao; contas: Contas } | 'ambiguo' | null {
  if (fecham(c, conferirLitros)) return null;
  const candidatos: Array<{ correcao: Correcao; contas: Contas; erro: number }> = [];
  for (const [campo, chave] of CAMPOS) {
    const lido = c[chave];
    if (fixos.has(campo) || lido == null || lido <= 0) continue;
    for (const v of variantesDeUmDigito(lido, 2)) {
      const contas = { ...c, [chave]: v };
      if (!fecham(contas, conferirLitros, true)) continue;
      const e = erros(contas, conferirLitros);
      candidatos.push({ correcao: { campo, lido, corrigido: v }, contas, erro: (e.total ?? 0) + (e.pago ?? 0) });
    }
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => a.erro - b.erro);
  const [melhor, segundo] = candidatos as [(typeof candidatos)[number], ...typeof candidatos];
  // outra correção quase tão boa: não dá para saber qual número está errado
  if (segundo && segundo.erro - melhor.erro < 0.01) return 'ambiguo';
  return { correcao: melhor.correcao, contas: melhor.contas };
}

/** "Quantidade corrigida para 40,35 L (a leitura deu 45,35 L): 40,35 L × R$ 8,08 = R$ 326,03…" */
export function descreverCorrecao(x: Correcao, c: Contas): string {
  const litros = (v: number) => `${litrosFmt.format(v)} L`;
  const de = (fmt: (v: number) => string) => `${fmt(x.corrigido)} (a leitura deu ${fmt(x.lido)})`;
  const total = c.valorBruto != null ? brl(c.valorBruto) : 'o valor total';
  const texto: Record<CampoCorrigivel, () => string> = {
    litros: () => `Quantidade corrigida para ${de(litros)}: ${litros(x.corrigido)} × ${brl(c.preco ?? 0)} = ${total}, o valor total da nota`,
    preco: () => `Preço da bomba corrigido para ${de(brl)}: ${litros(c.litros ?? 0)} × ${brl(x.corrigido)} = ${total}, o valor total da nota`,
    valorBruto: () => `Valor total corrigido para ${de(brl)}: é o único valor que fecha com litros × preço e com o valor pago`,
    desconto: () => `Desconto corrigido para ${de(brl)}: valor total − desconto = valor pago`,
    liquido: () => `Valor pago corrigido para ${de(brl)}: valor total − desconto = ${brl(x.corrigido)}`,
  };
  return `${texto[x.campo]()}. Confira na foto.`;
}

export function calcularCupom(l: LeituraCupom): CalculoCupom {
  const avisos: string[] = [];
  const conferencias: Conferencia[] = [];
  let preco = positivo(l.preco_unitario) ? l.preco_unitario : null;
  const liquidoItem = positivo(l.valor_liquido_item) ? l.valor_liquido_item : null;
  const descontoItem = l.desconto_item != null && l.desconto_item >= 0 ? l.desconto_item : null;
  const aPagar = !l.outros_itens && positivo(l.valor_a_pagar) ? l.valor_a_pagar : null;
  const acrescimo = !l.outros_itens && positivo(l.acrescimo_nota) ? l.acrescimo_nota : 0;
  const aPagarCombustivel = aPagar != null ? arred2(aPagar - acrescimo) : null;
  /** o que o cupom diz que foi pago pelo combustível (para conferir as contas) */
  let liquidoImpresso = liquidoItem ?? aPagarCombustivel;
  /** valor pago impresso duas vezes igual (linha e total da nota): não foi lido errado */
  const liquidoConfirmado = liquidoItem != null && aPagarCombustivel != null && perto(liquidoItem, aPagarCombustivel, TOLERANCIA_PAGO);
  const descontoImpresso = descontoItem ?? (!l.outros_itens && l.desconto_nota != null && l.desconto_nota > 0 ? l.desconto_nota : null);
  let litros = positivo(l.litros) ? l.litros : null;

  // 1. valor do combustível antes do desconto
  let valorBruto: number | null = null;
  let brutoDeLitros = false;
  /** calculado (não lido): não entra na correção de dígito */
  let brutoCalculado = false;
  if (positivo(l.valor_item)) valorBruto = l.valor_item;
  else if (!l.outros_itens && positivo(l.valor_total_nota)) valorBruto = l.valor_total_nota;
  else if (liquidoItem && descontoItem != null) {
    valorBruto = arred2(liquidoItem + descontoItem);
    brutoCalculado = true;
    avisos.push('O valor total do combustível não aparece: calculado pelo valor líquido + desconto da linha.');
  }

  // 1a. a quantidade às vezes sai com ponto no lugar da vírgula ("5.413 LT" = 5,413 L)
  if (litros && preco && valorBruto && !perto(litros * preco, valorBruto, toleranciaTotal(valorBruto))) {
    for (const divisor of [1000, 10_000]) {
      if (perto((litros / divisor) * preco, valorBruto, toleranciaTotal(valorBruto))) {
        litros = arred3(litros / divisor);
        avisos.push(`Quantidade lida como ${litrosFmt.format(litros)} L: o cupom usa ponto no lugar da vírgula.`);
        break;
      }
    }
  }

  // 1b. DANFE: "valor total da nota" já é com desconto; o valor antes do desconto é o dos produtos
  if (valorBruto && litros && preco && descontoImpresso && liquidoImpresso && perto(valorBruto, liquidoImpresso, TOLERANCIA_PAGO)) {
    const semDesconto = liquidoImpresso + descontoImpresso;
    if (perto(litros * preco, semDesconto, toleranciaTotal(semDesconto))) {
      valorBruto = arred2(semDesconto);
      avisos.push('O valor total lido já era o valor com desconto: usado o valor antes do desconto (litros × preço da bomba).');
    }
  }

  if (!valorBruto && litros && preco) {
    valorBruto = arred2(litros * preco);
    brutoDeLitros = true;
    avisos.push('O valor total do combustível não aparece no cupom: calculado por litros × preço da bomba.');
  }
  /** valor total impresso duas vezes igual (linha do combustível e total da nota) */
  const brutoConfirmado =
    !l.outros_itens && positivo(l.valor_item) && positivo(l.valor_total_nota) && perto(l.valor_item, l.valor_total_nota, TOLERANCIA_PAGO);

  // 1c. o valor pago aparece duas vezes (linha e nota) e uma das leituras diverge: vale a que fecha com o total
  const pagos = [liquidoItem, aPagarCombustivel].filter((v): v is number => v != null);

  // 2. desconto: o impresso que fecha com o valor líquido / a pagar; sem desconto impresso, a diferença
  const impressos: Array<{ valor: number; origem: OrigemDesconto }> = [];
  if (descontoItem != null) impressos.push({ valor: descontoItem, origem: 'item' });
  if (l.desconto_nota != null && l.desconto_nota >= 0) {
    if (!l.outros_itens) impressos.push({ valor: l.desconto_nota, origem: 'nota' });
    else if (valorBruto && positivo(l.valor_total_nota)) {
      impressos.push({ valor: arred2((l.desconto_nota * valorBruto) / l.valor_total_nota), origem: 'proporcional' });
    }
  }
  const pagoQueFecha = (d: number) => (valorBruto == null ? undefined : pagos.find((p) => perto(valorBruto! - d, p, TOLERANCIA_PAGO)));
  let escolhido = pagos.length ? impressos.find((c) => pagoQueFecha(c.valor) != null) : undefined;
  if (escolhido && impressos[0] && escolhido !== impressos[0] && impressos[0].valor !== escolhido.valor) {
    avisos.push(`O desconto lido na linha (${brl(impressos[0].valor)}) não fecha com o valor pago: usado ${brl(escolhido.valor)}.`);
  }
  if (escolhido) liquidoImpresso = pagoQueFecha(escolhido.valor) ?? liquidoImpresso;
  escolhido ??= impressos[0];
  if (!escolhido && valorBruto && liquidoImpresso != null && liquidoImpresso < valorBruto - 0.009) {
    escolhido = { valor: arred2(valorBruto - liquidoImpresso), origem: 'diferenca' };
    avisos.push('O desconto não aparece escrito: calculado pela diferença entre o valor total e o valor pago.');
  }
  if (escolhido?.origem === 'proporcional') {
    avisos.push('O desconto é da nota inteira (há outros produtos): foi dividido proporcionalmente ao valor do combustível.');
  }
  let desconto = escolhido?.valor ?? 0;
  /** desconto impresso duas vezes igual (linha e nota) */
  const descontoConfirmado = !l.outros_itens && descontoItem != null && l.desconto_nota != null && perto(descontoItem, l.desconto_nota, 0.005);

  // 2a. conferência cruzada: um número lido com um dígito errado (ex.: 40,35 lido como 45,35)
  const correcoes: Correcao[] = [];
  const fixos = new Set<CampoCorrigivel>();
  if (brutoDeLitros || brutoCalculado || brutoConfirmado) fixos.add('valorBruto');
  if (liquidoConfirmado) fixos.add('liquido');
  if (escolhido?.origem === 'diferenca' || escolhido?.origem === 'proporcional' || descontoConfirmado) fixos.add('desconto');
  const contas: Contas = { litros, preco, valorBruto, desconto, liquido: liquidoImpresso };
  const correcao = corrigirUmDigito(contas, { conferirLitros: !brutoDeLitros, fixos });
  if (correcao === 'ambiguo') {
    avisos.push('Um dos números parece lido errado, mas não dá para saber qual: confira litros, preço e valores na foto.');
  } else if (correcao) {
    ({ litros, preco, valorBruto, desconto, liquido: liquidoImpresso } = correcao.contas);
    correcoes.push(correcao.correcao);
    avisos.push(descreverCorrecao(correcao.correcao, correcao.contas));
  }

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
      perto(esperado, valorBruto, toleranciaTotal(valorBruto))
        ? { ok: true, texto: 'Litros × preço da bomba = valor total' }
        : { ok: false, texto: `Litros × preço da bomba dá ${brl(arred2(esperado))}, mas o valor total lido é ${brl(valorBruto)}` },
    );
  }
  if (valorBruto && liquidoImpresso != null) {
    const esperado = valorBruto - desconto;
    const rotulo = liquidoItem != null && liquidoImpresso === liquidoItem ? 'valor líquido' : 'valor a pagar';
    conferencias.push(
      perto(esperado, liquidoImpresso, TOLERANCIA_PAGO)
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

  // valor a pagar mostrado: o impresso, ou o corrigido quando a correção foi nele
  const pagoCorrigido = correcoes.find((x) => x.campo === 'liquido' && liquidoItem == null);
  return {
    litros,
    valorBruto,
    desconto,
    valorAPagar: pagoCorrigido ? arred2(pagoCorrigido.corrigido + acrescimo) : positivo(l.valor_a_pagar) ? l.valor_a_pagar : null,
    valorLiquido,
    unitarioComDesconto,
    precoBomba,
    conferencias,
    avisos,
    correcoes,
    confiavel:
      l.legivel &&
      litros != null &&
      valorBruto != null &&
      conferencias.length > 0 &&
      conferencias.every((c) => c.ok) &&
      desconto < valorBruto &&
      correcoes.length === 0,
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

/** KM a mais que o último registrado que ainda é plausível entre um registro e outro. */
export const KM_SALTO_CUPOM = 3000;
const kmFmt = new Intl.NumberFormat('pt-BR');

/**
 * KM impresso no cupom: é o que o frentista digitou, e a foto pode ser mal lida (212.855 lido
 * como 252.855). Um KM errado estraga o consumo (km/l) e gera alerta falso, então só é usado
 * se estiver entre o último KM do veículo e KM_SALTO_CUPOM acima dele.
 */
export function conferirKmCupom(kmCupom: number | null, kmVeiculo: number): { km: number | null; aviso: string | null } {
  if (!kmCupom) return { km: null, aviso: null };
  if (kmCupom >= kmVeiculo && kmCupom <= kmVeiculo + KM_SALTO_CUPOM) return { km: kmCupom, aviso: null };
  return {
    km: null,
    aviso: `KM no cupom (${kmFmt.format(kmCupom)}) não combina com o último registro do veículo (${kmFmt.format(kmVeiculo)}): digite o KM do hodômetro.`,
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
