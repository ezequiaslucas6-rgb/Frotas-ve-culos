/**
 * Regras de negócio dos alertas de manutenção e da saúde da frota.
 * Funções PURAS (sem I/O): usadas pelas Server Actions, pelo cron e pelo painel.
 *
 * Alerta de revisão preventiva (por KM rodado OU por período — vale o pior):
 *   vencido  -> KM atual >= KM da próxima revisão, ou data da revisão <= hoje
 *   proximo  -> faltam <= MARGEM_ALERTA_KM km, ou <= MARGEM_ALERTA_DIAS dias
 *   ok       -> dentro do plano (ou veículo sem plano de revisão cadastrado)
 *
 * Saúde do veículo (badge do painel):
 *   manutencao (vermelho) -> NÃO LIBERADO (avaria crítica no checklist, até o conserto ou a
 *                            liberação pelo responsável; checklist semanal do fim de semana não
 *                            feito; ou sem checklist diário e não liberado pelo supervisor),
 *                            último checklist crítico ainda não tratado, ou revisão vencida
 *   atencao    (amarelo)  -> conserto pendente (liberado pelo responsável), último checklist
 *                            com atenção ainda não tratado, ou revisão próxima
 *   liberado   (verde)    -> nenhum dos anteriores
 * "Tratado" = manutenção CORRETIVA concluída na data do checklist ou depois (ou, para a
 * avaria, a liberação do veículo depois do checklist).
 */
import { situacaoDaView, situacaoDiaria, situacaoSemanal, type SituacaoDiaria, type SituacaoSemanal } from '@/lib/checklist/cobranca';
import { addDays, diffDays, toISODate } from '@/lib/dates';
import type { Enums } from '@/types/database';

export const MARGEM_ALERTA_KM = 1000;
export const MARGEM_ALERTA_DIAS = 15;

export type NivelAlerta = Enums<'alerta_status'>;
export type SaudeVeiculo = 'liberado' | 'atencao' | 'manutencao';
type ChecklistStatus = Enums<'checklist_status'>;

const SEVERIDADE_ALERTA: Record<NivelAlerta, number> = { ok: 0, proximo: 1, vencido: 2 };

export interface PlanoRevisao {
  kmAtual: number;
  proximaRevisaoKm: number | null;
  proximaRevisaoData: string | null;
}

export interface AlertaRevisao {
  nivel: NivelAlerta;
  /** O que disparou o alerta. Vazio quando nivel = 'ok'. */
  motivos: Array<'km' | 'periodo'>;
  kmRestantes: number | null;
  diasRestantes: number | null;
}

export function calcularAlertaRevisao(
  plano: PlanoRevisao,
  hoje: string = toISODate(),
  margens: { km: number; dias: number } = { km: MARGEM_ALERTA_KM, dias: MARGEM_ALERTA_DIAS },
): AlertaRevisao {
  const kmRestantes = plano.proximaRevisaoKm == null ? null : plano.proximaRevisaoKm - plano.kmAtual;
  const diasRestantes = plano.proximaRevisaoData == null ? null : diffDays(hoje, plano.proximaRevisaoData);

  let nivel: NivelAlerta = 'ok';
  const motivos: AlertaRevisao['motivos'] = [];
  const registrar = (candidato: NivelAlerta, motivo: 'km' | 'periodo') => {
    if (candidato === 'ok') return;
    motivos.push(motivo);
    if (SEVERIDADE_ALERTA[candidato] > SEVERIDADE_ALERTA[nivel]) nivel = candidato;
  };

  if (kmRestantes != null) {
    registrar(kmRestantes <= 0 ? 'vencido' : kmRestantes <= margens.km ? 'proximo' : 'ok', 'km');
  }
  if (diasRestantes != null) {
    registrar(diasRestantes <= 0 ? 'vencido' : diasRestantes <= margens.dias ? 'proximo' : 'ok', 'periodo');
  }
  return { nivel, motivos, kmRestantes, diasRestantes };
}

/** Define a próxima revisão a partir de uma preventiva realizada (KM e data + intervalos do veículo). */
export function proximaRevisao(args: {
  kmRegistro: number;
  dataManutencao: string;
  intervaloKm: number;
  intervaloDias: number;
}): { km: number; data: string } {
  return {
    km: args.kmRegistro + args.intervaloKm,
    data: addDays(args.dataManutencao, args.intervaloDias),
  };
}

export interface EntradaSaude {
  ultimoChecklistStatus: ChecklistStatus | null;
  /** timestamptz do envio do último checklist */
  ultimoChecklistEm: string | null;
  /** data (YYYY-MM-DD) da última manutenção corretiva concluída */
  ultimaCorretivaEm: string | null;
  alerta: NivelAlerta;
  /** há bloqueio aberto (avaria crítica ainda não consertada nem liberada) */
  bloqueado?: boolean;
  /** timestamptz da última liberação do veículo (conserto ou responsável) */
  ultimaLiberacaoEm?: string | null;
  /** manutenções em aberto (conserto pendente) */
  manutencoesAbertas?: number;
  /** checklist semanal do ciclo (sábado/domingo) */
  semanal?: SituacaoSemanal;
  /** checklist diário de hoje e a decisão do supervisor */
  diaria?: SituacaoDiaria;
}

/** Por que o veículo não está liberado. */
export type MotivoBloqueio = 'avaria' | 'semanal' | 'diario';

export interface SaudeAvaliada {
  saude: SaudeVeiculo;
  /** Motivos legíveis para exibir ao usuário. */
  motivos: string[];
  /** veículo não liberado (não deve rodar): avaria, semanal atrasado ou decisão do supervisor */
  naoLiberado: boolean;
  /** o motivo do "não liberado" (null = liberado) */
  bloqueio: MotivoBloqueio | null;
}

export const TEXTO_BLOQUEIO: Record<MotivoBloqueio, string> = {
  avaria: 'Não liberado: avaria crítica no checklist',
  semanal: 'Não liberado: checklist semanal do fim de semana não feito',
  diario: 'Não liberado hoje: sem checklist diário (decisão do supervisor)',
};

export function avaliarSaudeVeiculo(entrada: EntradaSaude): SaudeAvaliada {
  const motivos: string[] = [];
  let saude: SaudeVeiculo = 'liberado';
  const piorar = (para: SaudeVeiculo) => {
    if (para === 'manutencao' || (para === 'atencao' && saude === 'liberado')) saude = para;
  };

  const { ultimoChecklistStatus: status, ultimoChecklistEm, ultimaCorretivaEm } = entrada;
  const avaria = Boolean(entrada.bloqueado);
  const bloqueio: MotivoBloqueio | null = avaria
    ? 'avaria'
    : entrada.semanal === 'atrasado'
      ? 'semanal'
      : entrada.diaria === 'nao_liberado'
        ? 'diario'
        : null;
  const naoLiberado = bloqueio != null;
  if (bloqueio) {
    piorar('manutencao');
    motivos.push(TEXTO_BLOQUEIO[bloqueio]);
  }
  if (!avaria && entrada.semanal === 'fazer') {
    piorar('atencao');
    motivos.push('Checklist semanal: fazer até domingo');
  }
  if (avaria) {
    // a avaria já explica o estado do último checklist
  } else if (status && status !== 'ok' && ultimoChecklistEm) {
    const consertado = ultimaCorretivaEm != null && ultimaCorretivaEm >= toISODate(ultimoChecklistEm);
    // a liberação do veículo depois do checklist também resolve a avaria (o conserto pode ficar pendente)
    const liberado = status === 'critico' && entrada.ultimaLiberacaoEm != null && entrada.ultimaLiberacaoEm >= ultimoChecklistEm;
    const tratado = consertado || liberado;
    if (!tratado) {
      if (status === 'critico') {
        piorar('manutencao');
        motivos.push('Avaria registrada no último checklist');
      } else {
        piorar('atencao');
        motivos.push('Itens em atenção no último checklist');
      }
    }
  }

  if (!avaria && (entrada.manutencoesAbertas ?? 0) > 0) {
    piorar('atencao');
    motivos.push('Conserto pendente');
  }

  if (entrada.alerta === 'vencido') {
    piorar('manutencao');
    motivos.push('Revisão preventiva vencida');
  } else if (entrada.alerta === 'proximo') {
    piorar('atencao');
    motivos.push('Revisão preventiva próxima');
  }

  return { saude, motivos, naoLiberado, bloqueio };
}

/** Atalho: dado um veículo da view do painel, devolve alerta + saúde. */
export function avaliarVeiculoPainel(
  v: {
    km_atual: number;
    proxima_revisao_km: number | null;
    proxima_revisao_data: string | null;
    ultimo_checklist_status: ChecklistStatus | null;
    ultimo_checklist_em: string | null;
    ultima_corretiva_em: string | null;
    bloqueio_id?: string | null;
    ultima_liberacao_em?: string | null;
    manutencoes_abertas?: number | null;
    created_at?: string | null;
    ultimo_semanal_em?: string | null;
    ultimo_mensal_em?: string | null;
    liberacao_diaria?: boolean | null;
  },
  hoje: string = toISODate(),
  agora: Date | string | number = new Date(),
): { alerta: AlertaRevisao; semanal: SituacaoSemanal; diaria: SituacaoDiaria } & SaudeAvaliada {
  const alerta = calcularAlertaRevisao(
    { kmAtual: v.km_atual, proximaRevisaoKm: v.proxima_revisao_km, proximaRevisaoData: v.proxima_revisao_data },
    hoje,
  );
  const feitos = situacaoDaView(v, hoje);
  const semanal = situacaoSemanal(feitos.semanal, hoje, v.created_at);
  const diaria = situacaoDiaria(feitos.diario, v.liberacao_diaria, agora);
  const saude = avaliarSaudeVeiculo({
    ultimoChecklistStatus: v.ultimo_checklist_status,
    ultimoChecklistEm: v.ultimo_checklist_em,
    ultimaCorretivaEm: v.ultima_corretiva_em,
    alerta: alerta.nivel,
    bloqueado: Boolean(v.bloqueio_id),
    ultimaLiberacaoEm: v.ultima_liberacao_em ?? null,
    manutencoesAbertas: v.manutencoes_abertas ?? 0,
    semanal,
    diaria,
  });
  return { alerta, semanal, diaria, ...saude };
}
