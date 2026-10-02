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
 *   manutencao (vermelho) -> último checklist crítico (avaria) ainda não tratado,
 *                            ou revisão vencida
 *   atencao    (amarelo)  -> último checklist com atenção ainda não tratado,
 *                            ou revisão próxima
 *   liberado   (verde)    -> nenhum dos anteriores
 * "Tratado" = existe manutenção CORRETIVA registrada na data do checklist ou depois.
 */
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
  /** data (YYYY-MM-DD) da última manutenção corretiva */
  ultimaCorretivaEm: string | null;
  alerta: NivelAlerta;
}

export interface SaudeAvaliada {
  saude: SaudeVeiculo;
  /** Motivos legíveis para exibir ao usuário. */
  motivos: string[];
}

export function avaliarSaudeVeiculo(entrada: EntradaSaude): SaudeAvaliada {
  const motivos: string[] = [];
  let saude: SaudeVeiculo = 'liberado';
  const piorar = (para: SaudeVeiculo) => {
    if (para === 'manutencao' || (para === 'atencao' && saude === 'liberado')) saude = para;
  };

  const { ultimoChecklistStatus: status, ultimoChecklistEm, ultimaCorretivaEm } = entrada;
  if (status && status !== 'ok' && ultimoChecklistEm) {
    const tratado = ultimaCorretivaEm != null && ultimaCorretivaEm >= toISODate(ultimoChecklistEm);
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

  if (entrada.alerta === 'vencido') {
    piorar('manutencao');
    motivos.push('Revisão preventiva vencida');
  } else if (entrada.alerta === 'proximo') {
    piorar('atencao');
    motivos.push('Revisão preventiva próxima');
  }

  return { saude, motivos };
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
  },
  hoje: string = toISODate(),
): { alerta: AlertaRevisao } & SaudeAvaliada {
  const alerta = calcularAlertaRevisao(
    { kmAtual: v.km_atual, proximaRevisaoKm: v.proxima_revisao_km, proximaRevisaoData: v.proxima_revisao_data },
    hoje,
  );
  const saude = avaliarSaudeVeiculo({
    ultimoChecklistStatus: v.ultimo_checklist_status,
    ultimoChecklistEm: v.ultimo_checklist_em,
    ultimaCorretivaEm: v.ultima_corretiva_em,
    alerta: alerta.nivel,
  });
  return { alerta, ...saude };
}
