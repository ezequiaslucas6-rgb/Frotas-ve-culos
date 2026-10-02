/** Datas "de calendário" (YYYY-MM-DD) no fuso do negócio, sem depender do fuso do servidor. */
export const TIMEZONE = 'America/Sao_Paulo';

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de hoje (ou de um instante qualquer) em America/Sao_Paulo, como YYYY-MM-DD. */
export function toISODate(instant: Date | string | number = new Date()): string {
  return isoFormatter.format(new Date(instant));
}

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/** Diferença em dias inteiros: b - a. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUTC(iso) + days * 86_400_000).toISOString().slice(0, 10);
}
