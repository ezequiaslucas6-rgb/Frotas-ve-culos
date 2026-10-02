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

/**
 * Consumo pelo método tanque cheio a tanque cheio, por veículo: a distância entre
 * dois abastecimentos completos dividida pelos litros colocados depois do primeiro
 * (inclui os parciais do meio). GNV (m³) fica fora do cálculo em km/l.
 */
export function calcularConsumo(lancamentos: LancamentoConsumo[]): Consumo {
  const ordenados = lancamentos
    .filter((l) => l.combustivel !== 'gnv')
    .toSorted((a, b) => a.km - b.km || a.data_abastecimento.localeCompare(b.data_abastecimento));

  const porLancamento: Record<string, number> = {};
  let kmBase: number | null = null;
  let litros = 0;
  let kmTotal = 0;
  let litrosTotal = 0;

  for (const l of ordenados) {
    if (kmBase === null) {
      if (l.tanque_cheio) kmBase = l.km;
      continue;
    }
    litros += Number(l.litros);
    if (!l.tanque_cheio) continue;
    const distancia = l.km - kmBase;
    if (distancia > 0 && litros > 0) {
      porLancamento[l.id] = distancia / litros;
      kmTotal += distancia;
      litrosTotal += litros;
    }
    kmBase = l.km;
    litros = 0;
  }

  return { porLancamento, media: litrosTotal > 0 ? kmTotal / litrosTotal : null };
}

const kml = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatKmL = (v: number | null | undefined) => (v == null ? '—' : `${kml.format(v)} km/l`);

const litrosFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const formatLitros = (v: number, combustivel?: Combustivel) =>
  `${litrosFmt.format(v)} ${combustivel === 'gnv' ? 'm³' : 'L'}`;

const precoFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 3 });
export const formatPrecoLitro = (v: number) => precoFmt.format(v);
