import type { Enums } from '@/types/database';

export type Combustivel = Enums<'combustivel'>;

export const COMBUSTIVEIS: Array<{ value: Combustivel; label: string }> = [
  { value: 'diesel_s10', label: 'Diesel S10' },
  { value: 'diesel_s500', label: 'Diesel S500' },
  { value: 'gasolina', label: 'Gasolina comum' },
  { value: 'gasolina_aditivada', label: 'Gasolina aditivada' },
  { value: 'etanol', label: 'Etanol' },
  { value: 'gnv', label: 'GNV (m³)' },
];

export const combustivelLabel = (c: Combustivel) => COMBUSTIVEIS.find((x) => x.value === c)?.label ?? c;

/**
 * Número digitado no padrão brasileiro: "1.234,56", "40,5", "40.5", "239".
 * Com vírgula, o ponto é separador de milhar; só com ponto, "1.234" é milhar e "40.5" é decimal.
 */
export function parseDecimalBR(input: unknown): number | undefined {
  if (typeof input === 'number') return input;
  if (typeof input !== 'string') return undefined;
  let v = input.trim().replace(/\s|R\$/g, '');
  if (!v) return undefined;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

export interface LancamentoConsumo {
  id: string;
  km: number;
  litros: number;
  tanque_cheio: boolean;
  combustivel: Combustivel;
  data_abastecimento: string;
}

export interface Consumo {
  /** km/l de cada lançamento que fecha um ciclo "tanque cheio → tanque cheio" */
  porLancamento: Record<string, number>;
  /** média ponderada (km totais / litros totais dos ciclos fechados) */
  media: number | null;
}

/** Um ciclo fechado "tanque cheio -> tanque cheio": distância, litros e km/l. */
export interface CicloConsumo {
  /** lançamento (tanque cheio) que fecha o ciclo */
  id: string;
  data: string;
  combustivel: Combustivel;
  distancia: number;
  litros: number;
  kml: number;
}

/**
 * Ciclos pelo método tanque cheio a tanque cheio, por veículo: a distância entre
 * dois abastecimentos completos dividida pelos litros colocados depois do primeiro
 * (inclui os parciais do meio). GNV (m³) fica fora do cálculo em km/l.
 */
export function ciclosConsumo(lancamentos: LancamentoConsumo[]): CicloConsumo[] {
  const ordenados = lancamentos
    .filter((l) => l.combustivel !== 'gnv')
    .toSorted((a, b) => a.km - b.km || a.data_abastecimento.localeCompare(b.data_abastecimento));

  const ciclos: CicloConsumo[] = [];
  let kmBase: number | null = null;
  let litros = 0;
  for (const l of ordenados) {
    if (kmBase === null) {
      if (l.tanque_cheio) kmBase = l.km;
      continue;
    }
    litros += Number(l.litros);
    if (!l.tanque_cheio) continue;
    const distancia = l.km - kmBase;
    if (distancia > 0 && litros > 0) {
      ciclos.push({ id: l.id, data: l.data_abastecimento, combustivel: l.combustivel, distancia, litros, kml: distancia / litros });
    }
    kmBase = l.km;
    litros = 0;
  }
  return ciclos;
}

export function calcularConsumo(lancamentos: LancamentoConsumo[]): Consumo {
  const ciclos = ciclosConsumo(lancamentos);
  const kmTotal = ciclos.reduce((s, c) => s + c.distancia, 0);
  const litrosTotal = ciclos.reduce((s, c) => s + c.litros, 0);
  return {
    porLancamento: Object.fromEntries(ciclos.map((c) => [c.id, c.kml])),
    media: litrosTotal > 0 ? kmTotal / litrosTotal : null,
  };
}

/** Queda que dispara o alerta (vazamento, desvio de combustível ou hodômetro errado). */
export const QUEDA_CONSUMO = 0.25;
/** Alta que indica hodômetro suspeito (ou abastecimento não lançado). */
export const ALTA_CONSUMO = 0.6;
/** Referência: média dos últimos ciclos normais do mesmo combustível. */
export const CICLOS_REFERENCIA = 5;
export const CICLOS_MINIMOS = 2;

export interface AnomaliaConsumo {
  id: string;
  data: string;
  kml: number;
  /** km/l normal do veículo (mesmo combustível) */
  referencia: number;
  /** ex.: -0.32 = 32% abaixo do normal */
  variacao: number;
  tipo: 'queda' | 'alta';
}

/**
 * Consumo fora do padrão, por veículo. Cada ciclo é comparado à média ponderada dos até
 * CICLOS_REFERENCIA ciclos NORMAIS anteriores com o mesmo combustível (etanol e gasolina
 * rendem diferente). Ciclos anormais não entram na referência. `ultima` = o ciclo mais
 * recente, se for anormal (é o que o painel cobra).
 */
export function detectarConsumoAnormal(lancamentos: LancamentoConsumo[]): {
  porLancamento: Record<string, AnomaliaConsumo>;
  ultima: AnomaliaConsumo | null;
} {
  const ciclos = ciclosConsumo(lancamentos);
  const normais: CicloConsumo[] = [];
  const porLancamento: Record<string, AnomaliaConsumo> = {};
  for (const c of ciclos) {
    const base = normais.filter((n) => n.combustivel === c.combustivel).slice(-CICLOS_REFERENCIA);
    if (base.length >= CICLOS_MINIMOS) {
      const referencia = base.reduce((s, n) => s + n.distancia, 0) / base.reduce((s, n) => s + n.litros, 0);
      const variacao = (c.kml - referencia) / referencia;
      if (variacao <= -QUEDA_CONSUMO || variacao >= ALTA_CONSUMO) {
        porLancamento[c.id] = { id: c.id, data: c.data, kml: c.kml, referencia, variacao, tipo: variacao < 0 ? 'queda' : 'alta' };
        continue;
      }
    }
    normais.push(c);
  }
  const ultimo = ciclos.at(-1);
  return { porLancamento, ultima: ultimo ? (porLancamento[ultimo.id] ?? null) : null };
}

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
/** "32% abaixo do normal" / "70% acima do normal" */
export const descreverAnomalia = (a: AnomaliaConsumo) => `${pct(a.variacao)} ${a.tipo === 'queda' ? 'abaixo' : 'acima'} do normal`;
/** O que conferir, em linguagem simples. */
export const dicaAnomalia = (a: AnomaliaConsumo) =>
  a.tipo === 'queda' ? 'Possível vazamento, desvio de combustível ou KM digitado errado.' : 'Confira o hodômetro (KM digitado errado ou abastecimento não lançado).';

const kml = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatKmL = (v: number | null | undefined) => (v == null ? '—' : `${kml.format(v)} km/l`);

const litrosFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const formatLitros = (v: number, combustivel?: Combustivel) =>
  `${litrosFmt.format(v)} ${combustivel === 'gnv' ? 'm³' : 'L'}`;

const precoFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 3 });
export const formatPrecoLitro = (v: number) => precoFmt.format(v);
