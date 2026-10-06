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
