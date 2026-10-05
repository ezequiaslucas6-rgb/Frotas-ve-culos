/**
 * Cobrança de checklists: quais veículos ainda não fizeram o diário de HOJE, o semanal
 * DESTA SEMANA (segunda a domingo) e o mensal DESTE MÊS — no fuso de São Paulo.
 *
 * Um checklist maior cobre os menores do mesmo dia/período (o modelo padrão do semanal
 * contém as fotos do diário, e o do mensal as do semanal):
 *   mensal  -> conta como mensal do mês, semanal da semana e diário do dia
 *   semanal -> conta como semanal da semana e diário do dia
 *   diario  -> conta só como diário do dia
 * Funções puras (sem I/O).
 */
import { addDays, toISODate } from '@/lib/dates';
import type { ChecklistTipo } from './etapas';

export const TIPOS_COBRANCA: readonly ChecklistTipo[] = ['diario', 'semanal', 'mensal'];

export interface PeriodosCobranca {
  /** início (YYYY-MM-DD) de cada período */
  diario: string;
  semanal: string;
  mensal: string;
}

/** Segunda-feira da semana de `dia` (YYYY-MM-DD). */
export function inicioDaSemana(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number) as [number, number, number];
  const semana = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(dia, -((semana + 6) % 7));
}

export function periodosCobranca(hoje: string): PeriodosCobranca {
  return { diario: hoje, semanal: inicioDaSemana(hoje), mensal: `${hoje.slice(0, 8)}01` };
}

/** Desde quando buscar checklists para cobrir os três períodos (a semana pode começar no mês anterior). */
export const inicioDaBusca = (p: PeriodosCobranca) => (p.semanal < p.mensal ? p.semanal : p.mensal);

/** Tipos que um checklist de `tipo` cobre. */
const COBRE: Record<ChecklistTipo, ChecklistTipo[]> = {
  diario: ['diario'],
  semanal: ['semanal', 'diario'],
  mensal: ['mensal', 'semanal', 'diario'],
};

export type SituacaoCobranca = Record<ChecklistTipo, boolean>;

/** Para cada veículo: true = já fez (ou foi coberto) no período; false = pendente. */
export function situacaoCobranca(
  veiculoIds: readonly string[],
  checklists: ReadonlyArray<{ veiculo_id: string; tipo: ChecklistTipo; data_envio: string }>,
  hoje: string = toISODate(),
): Map<string, SituacaoCobranca> {
  const p = periodosCobranca(hoje);
  const situacao = new Map(veiculoIds.map((id) => [id, { diario: false, semanal: false, mensal: false } as SituacaoCobranca]));
  for (const c of checklists) {
    const s = situacao.get(c.veiculo_id);
    if (!s) continue;
    const dia = toISODate(c.data_envio);
    if (dia > hoje) continue;
    for (const tipo of COBRE[c.tipo]) {
      if (dia >= p[tipo]) s[tipo] = true;
    }
  }
  return situacao;
}

/** Resumo por tipo: quantos fizeram e quais estão pendentes. */
export function resumoCobranca<V extends { id: string }>(veiculos: readonly V[], situacao: Map<string, SituacaoCobranca>) {
  return Object.fromEntries(
    TIPOS_COBRANCA.map((tipo) => {
      const pendentes = veiculos.filter((v) => !situacao.get(v.id)?.[tipo]);
      return [tipo, { feitos: veiculos.length - pendentes.length, total: veiculos.length, pendentes }];
    }),
  ) as Record<ChecklistTipo, { feitos: number; total: number; pendentes: V[] }>;
}
