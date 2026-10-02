import { TIMEZONE } from '@/lib/dates';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR');

export const formatBRL = (value: number) => brl.format(value);
export const formatKm = (value: number) => `${num.format(value)} km`;
export const formatNumber = (value: number) => num.format(value);

/** "2026-03-10" -> "10/03/2026" (sem passar por Date, evitando deslocamento de fuso) */
export function formatDateISO(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export const formatDateTime = (instant: string | Date | null | undefined) =>
  instant ? dateTime.format(new Date(instant)) : '—';

export const formatVeiculo = (v: { placa: string; marca?: string | null; modelo?: string | null }) =>
  [v.placa, [v.marca, v.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

export const formatFilial = (f: { nome_cidade: string; uf: string }) => `${f.nome_cidade}/${f.uf}`;
