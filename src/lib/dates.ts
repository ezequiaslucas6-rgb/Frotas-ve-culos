/**
 * Datas "de calendário" (YYYY-MM-DD) e horas no fuso do negócio, sem depender do fuso do
 * servidor: Pimenta Bueno/RO (America/Porto_Velho, UTC−4, sem horário de verão).
 */
export const TIMEZONE = 'America/Porto_Velho';

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de hoje (ou de um instante qualquer) no horário de Pimenta Bueno, como YYYY-MM-DD. */
export function toISODate(instant: Date | string | number = new Date()): string {
  return isoFormatter.format(new Date(instant));
}

const horaFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Hora local "HH:MM" (horário de Pimenta Bueno) de um instante. */
export function horaLocal(instant: Date | string | number = new Date()): string {
  return horaFormatter.format(new Date(instant));
}

const partesFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Instante (ISO, UTC) em que começa o dia `dia` no horário de Pimenta Bueno: para filtrar o banco. */
export function inicioDoDia(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d);
  const p = Object.fromEntries(partesFormatter.formatToParts(new Date(utc)).map((x) => [x.type, Number(x.value)]));
  const relogioLocal = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return new Date(utc - (relogioLocal - utc)).toISOString();
}

/** Dia da semana de uma data YYYY-MM-DD (0 = domingo … 6 = sábado). */
export function diaDaSemana(dia: string): number {
  const [y, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
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

const mesFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-10" → "Outubro de 2026" */
export function rotuloMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  const texto = mesFormatter.format(new Date(Date.UTC(y, m - 1, 1)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Meses "YYYY-MM" de `fim` (o mais recente) até `inicio`, no máximo `limite` meses. */
export function mesesEntre(inicio: string, fim: string, limite = 120): string[] {
  const meses: string[] = [];
  let [y, m] = fim.split('-').map(Number) as [number, number];
  while (meses.length < limite) {
    const atual = `${y}-${String(m).padStart(2, '0')}`;
    meses.push(atual);
    if (atual <= inicio) break;
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return meses;
}
