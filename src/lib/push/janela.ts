import { horaLocal } from '@/lib/dates';
import type { Momento } from '@/lib/checklist/lembretes';

/** Hora de cada lembrete, no horário de Pimenta Bueno/RO. */
export const HORA_DO_MOMENTO: Record<Momento, string> = { '0800': '08:00', '0830': '08:30' };

/**
 * O agendador do servidor roda TODO minuto. O lembrete sai no primeiro minuto da hora e, se o
 * servidor estava fora do ar nesse minuto, ainda sai até esta tolerância depois (um aviso
 * atrasado de poucos minutos vale mais que nenhum).
 */
export const TOLERANCIA_MIN = 15;

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Qual lembrete deve sair agora (horário de Pimenta Bueno)? null = nenhum. */
export function momentoDeDisparo(agora: Date | string | number = new Date()): Momento | null {
  const atual = minutos(horaLocal(agora));
  for (const [momento, hora] of Object.entries(HORA_DO_MOMENTO) as Array<[Momento, string]>) {
    const passou = atual - minutos(hora);
    if (passou >= 0 && passou < TOLERANCIA_MIN) return momento;
  }
  return null;
}
