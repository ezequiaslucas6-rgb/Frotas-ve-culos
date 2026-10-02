import { diffDays } from '@/lib/dates';

export const CNH_CATEGORIAS = ['A', 'B', 'AB', 'C', 'AC', 'D', 'AD', 'E', 'AE', 'ACC'] as const;
export type CnhCategoria = (typeof CNH_CATEGORIAS)[number];

/** Com quantos dias de antecedência a CNH entra em alerta. */
export const CNH_AVISO_DIAS = 30;

export type SituacaoCnh =
  | { nivel: 'sem_dados' }
  | { nivel: 'ok' | 'vence' | 'vencida'; validade: string; dias: number };

/**
 * Situação da CNH pela validade (datas YYYY-MM-DD, fuso de São Paulo).
 *  - vencida: validade anterior a hoje
 *  - vence:   faltam até CNH_AVISO_DIAS dias (inclui vencer hoje)
 * `dias` = dias até a validade (negativo quando vencida).
 */
export function situacaoCnh(validade: string | null | undefined, hoje: string): SituacaoCnh {
  if (!validade) return { nivel: 'sem_dados' };
  const dias = diffDays(hoje, validade);
  if (dias < 0) return { nivel: 'vencida', validade, dias };
  if (dias <= CNH_AVISO_DIAS) return { nivel: 'vence', validade, dias };
  return { nivel: 'ok', validade, dias };
}

export function descreverSituacaoCnh(s: SituacaoCnh): string {
  switch (s.nivel) {
    case 'sem_dados':
      return 'Validade não informada';
    case 'vencida':
      return s.dias === -1 ? 'Vencida ontem' : `Vencida há ${-s.dias} dias`;
    case 'vence':
      return s.dias === 0 ? 'Vence hoje' : s.dias === 1 ? 'Vence amanhã' : `Vence em ${s.dias} dias`;
    case 'ok':
      return 'Em dia';
  }
}
