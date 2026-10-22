/**
 * Cobrança de checklists, no horário de Pimenta Bueno/RO:
 *
 *  - DIÁRIO: não é obrigatório. Até as 08:30 (PRAZO_DIARIO) o motorista faz o do dia; depois
 *    disso o supervisor vê quem não fez e decide, veículo a veículo, se está liberado para
 *    uso hoje. "Não liberado" vale até o veículo fazer o checklist do dia.
 *  - SEMANAL: obrigatório no sábado ou no domingo. Sem ele, o veículo fica "não liberado" de
 *    segunda em diante, até fazer (o atrasado continua valendo para aquela semana).
 *  - MENSAL: o do mês, sem bloqueio.
 *
 * FOLGA do motorista (dias da semana em que ele não trabalha, ex.: sexta a domingo): o veículo
 * dele não gera checklist diário pendente nesses dias e, com sábado E domingo de folga, o
 * semanal do fim de semana também não é cobrado (não fica "não liberado" na segunda).
 *
 * Um checklist maior cobre os menores (o modelo do semanal contém as fotos do diário, e o do
 * mensal as do semanal):
 *   mensal  -> conta como mensal do mês, semanal da semana e diário do dia
 *   semanal -> conta como semanal da semana e diário do dia
 *   diario  -> conta só como diário do dia
 * Funções puras (sem I/O).
 */
import { addDays, diaDaSemana, horaLocal, toISODate } from '@/lib/dates';
import type { ChecklistTipo } from './etapas';

export const TIPOS_COBRANCA: readonly ChecklistTipo[] = ['diario', 'semanal', 'mensal'];

/** Prazo do checklist diário (hora local): depois disso o supervisor decide a liberação. */
export const PRAZO_DIARIO = '08:30';
/** Hora do lembrete do motorista no app. */
export const LEMBRETE_MOTORISTA = '08:00';
/**
 * Primeiro fim de semana em que o semanal passou a ser obrigatório. Antes disso nenhum
 * veículo fica bloqueado por semanal atrasado (a regra não pega a frota de surpresa).
 */
export const SEMANAL_OBRIGATORIO_DESDE = '2026-10-10';

/** Dias de folga do motorista: 0 = domingo … 6 = sábado (vazio ou ausente = trabalha todos os dias). */
export type DiasFolga = readonly number[] | null | undefined;

export const NOMES_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
export const NOMES_DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** O motorista está de folga em `dia` (YYYY-MM-DD)? */
export const emFolga = (diasFolga: DiasFolga, dia: string) => Boolean(diasFolga?.includes(diaDaSemana(dia)));

/** Sábado e domingo de folga: o semanal do fim de semana não é cobrado. */
export const semanalDispensado = (diasFolga: DiasFolga) => Boolean(diasFolga?.includes(6) && diasFolga.includes(0));

/** "sex, sáb e dom" (na ordem da semana, começando na segunda); '' se não há folga. */
export function descreverFolga(diasFolga: DiasFolga): string {
  const dias = [...new Set(diasFolga ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const nomes = dias.map((d) => NOMES_DIAS_CURTOS[d]!);
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : (nomes[0] ?? '');
}

export interface PeriodosCobranca {
  /** início (YYYY-MM-DD) de cada período */
  diario: string;
  semanal: string;
  mensal: string;
}

/** Sábado que abre o ciclo semanal de `dia` (o sábado de hoje, de ontem ou o último). */
export function inicioDoCicloSemanal(dia: string): string {
  return addDays(dia, -((diaDaSemana(dia) + 1) % 7));
}

/** Sábado ou domingo: os dias do checklist semanal. */
export const ehFimDeSemana = (dia: string) => {
  const d = diaDaSemana(dia);
  return d === 0 || d === 6;
};

export function periodosCobranca(hoje: string): PeriodosCobranca {
  return { diario: hoje, semanal: inicioDoCicloSemanal(hoje), mensal: `${hoje.slice(0, 8)}01` };
}

/** Desde quando buscar checklists para cobrir os três períodos (o ciclo pode começar no mês anterior). */
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

/** A mesma situação a partir das colunas da view do painel (último checklist de cada tipo). */
export function situacaoDaView(
  v: { ultimo_checklist_em: string | null; ultimo_semanal_em?: string | null; ultimo_mensal_em?: string | null },
  hoje: string = toISODate(),
): SituacaoCobranca {
  const p = periodosCobranca(hoje);
  const desde = (instante: string | null | undefined, inicio: string) => {
    if (!instante) return false;
    const dia = toISODate(instante);
    return dia >= inicio && dia <= hoje;
  };
  return {
    // qualquer tipo cobre o diário: basta o último checklist ser de hoje
    diario: desde(v.ultimo_checklist_em, p.diario),
    semanal: desde(v.ultimo_semanal_em, p.semanal),
    mensal: desde(v.ultimo_mensal_em, p.mensal),
  };
}

/**
 * Semanal de um veículo:
 *   feito    -> fez no ciclo (desde o último sábado)
 *   folga    -> motorista de folga no sábado E no domingo: o semanal não é cobrado
 *   fazer    -> é sábado ou domingo e ainda não fez (é hoje!)
 *   atrasado -> segunda a sexta sem o do fim de semana: NÃO LIBERADO até fazer
 *   proximo  -> segunda a sexta, mas a obrigação ainda não valia (regra nova ou veículo novo)
 */
export type SituacaoSemanal = 'feito' | 'folga' | 'fazer' | 'atrasado' | 'proximo';

export function situacaoSemanal(feito: boolean, hoje: string, veiculoCriadoEm?: string | null, diasFolga?: DiasFolga): SituacaoSemanal {
  if (feito) return 'feito';
  if (semanalDispensado(diasFolga)) return 'folga';
  if (ehFimDeSemana(hoje)) return 'fazer';
  const ciclo = inicioDoCicloSemanal(hoje);
  if (ciclo < SEMANAL_OBRIGATORIO_DESDE) return 'proximo';
  // cadastrado depois do sábado: não teve o fim de semana inteiro para fazer
  if (veiculoCriadoEm && toISODate(veiculoCriadoEm) > ciclo) return 'proximo';
  return 'atrasado';
}

/**
 * Diário de um veículo:
 *   feito        -> fez hoje (qualquer tipo cobre)
 *   folga        -> o motorista está de folga hoje: nada a cobrar
 *   aguardando   -> ainda não fez e não passou das 08:30
 *   decidir      -> passou das 08:30 sem checklist e sem decisão do supervisor
 *   liberado     -> sem checklist, liberado pelo supervisor
 *   nao_liberado -> sem checklist, NÃO liberado pelo supervisor (até fazer o checklist)
 */
export type SituacaoDiaria = 'feito' | 'folga' | 'aguardando' | 'decidir' | 'liberado' | 'nao_liberado';

export function situacaoDiaria(
  feito: boolean,
  decisao: boolean | null | undefined,
  agora: Date | string | number = new Date(),
  diasFolga?: DiasFolga,
): SituacaoDiaria {
  if (feito) return 'feito';
  if (emFolga(diasFolga, toISODate(agora))) return 'folga';
  if (decisao === true) return 'liberado';
  if (decisao === false) return 'nao_liberado';
  return horaLocal(agora) < PRAZO_DIARIO ? 'aguardando' : 'decidir';
}

/**
 * Resumo por tipo: quantos fizeram e quais estão pendentes. `dispensado` diz se o veículo está
 * fora da cobrança do tipo (folga do motorista): não entra no total nem nos pendentes e é contado em `folga`.
 */
export function resumoCobranca<V extends { id: string }>(
  veiculos: readonly V[],
  situacao: Map<string, SituacaoCobranca>,
  dispensado: (v: V, tipo: ChecklistTipo) => boolean = () => false,
) {
  return Object.fromEntries(
    TIPOS_COBRANCA.map((tipo) => {
      const cobrados = veiculos.filter((v) => !dispensado(v, tipo));
      const pendentes = cobrados.filter((v) => !situacao.get(v.id)?.[tipo]);
      return [tipo, { feitos: cobrados.length - pendentes.length, total: cobrados.length, pendentes, folga: veiculos.length - cobrados.length }];
    }),
  ) as Record<ChecklistTipo, { feitos: number; total: number; pendentes: V[]; folga: number }>;
}

/** "sáb 10/10 e dom 11/10" — os dias do semanal do ciclo de `hoje`. */
export function diasDoSemanal(hoje: string): { sabado: string; domingo: string } {
  const sabado = ehFimDeSemana(hoje) ? inicioDoCicloSemanal(hoje) : addDays(inicioDoCicloSemanal(hoje), 7);
  return { sabado, domingo: addDays(sabado, 1) };
}
