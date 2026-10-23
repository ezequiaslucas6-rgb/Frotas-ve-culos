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
 * FOLGA da semana do motorista (sexta, sábado e domingo, no revezamento de plantão): o veículo
 * dele não gera checklist diário pendente nesses dias e o semanal do fim de semana de folga não
 * é cobrado (o veículo não fica "não liberado" na segunda). A folga acaba sozinha no domingo.
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

/**
 * Folga da semana do motorista (revezamento de plantão): o supervisor toca em "Folga da semana" e o
 * motorista fica de folga na SEXTA, no SÁBADO e no DOMINGO daquela semana (semana de segunda a
 * domingo). Cada folga é guardada pela data da sexta-feira que a abre e acaba sozinha no domingo:
 * na segunda o motorista volta, sem ninguém precisar desmarcar.
 */
export type Folgas = readonly string[] | null | undefined;

/** Sexta-feira da semana de `dia` (semana de segunda a domingo): o início do fim de semana de folga. */
export const sextaDaSemana = (dia: string) => addDays(dia, 4 - ((diaDaSemana(dia) + 6) % 7));

/** Último dia (domingo) da folga que começa na sexta `sexta`. */
export const domingoDaFolga = (sexta: string) => addDays(sexta, 2);

/** O motorista está de folga em `dia` (YYYY-MM-DD)? Vale a sexta, o sábado e o domingo de cada folga marcada. */
export const emFolga = (folgas: Folgas, dia: string) => Boolean(folgas?.some((sexta) => dia >= sexta && dia <= domingoDaFolga(sexta)));

/**
 * O semanal do ciclo de `hoje` (sábado e domingo) está dispensado? Sim, se o motorista estava de
 * folga naquele fim de semana: o sábado e o domingo são do ciclo, e a sexta antes deles é a que
 * abre a folga. Continua valendo de segunda a sexta (o veículo não fica "não liberado" na segunda).
 */
export const semanalDispensado = (folgas: Folgas, hoje: string) => Boolean(folgas?.includes(addDays(inicioDoCicloSemanal(hoje), -1)));

const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const curto = (dia: string) => `${SEM[diaDaSemana(dia)]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** "sex 24/10 a dom 26/10": os dias exatos da folga que começa na sexta `sexta`. */
export const descreverFolga = (sexta: string) => `${curto(sexta)} a ${curto(domingoDaFolga(sexta))}`;

/** A folga em andamento ou a próxima (a que o motorista tem agora ou ainda vai ter), se houver. */
export const folgaVigente = (folgas: Folgas, hoje: string): string | null =>
  [...(folgas ?? [])].filter((sexta) => domingoDaFolga(sexta) >= hoje).sort()[0] ?? null;

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

export function situacaoSemanal(feito: boolean, hoje: string, veiculoCriadoEm?: string | null, folgas?: Folgas): SituacaoSemanal {
  if (feito) return 'feito';
  if (semanalDispensado(folgas, hoje)) return 'folga';
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
  folgas?: Folgas,
): SituacaoDiaria {
  if (feito) return 'feito';
  if (emFolga(folgas, toISODate(agora))) return 'folga';
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
