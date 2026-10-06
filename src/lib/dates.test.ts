import { describe, expect, it } from 'vitest';
import { mesesEntre, rotuloMes } from './dates';

describe('meses do filtro', () => {
  it('rótulo em português, com maiúscula', () => {
    expect(rotuloMes('2026-10')).toBe('Outubro de 2026');
    expect(rotuloMes('2025-03')).toBe('Março de 2025');
  });

  it('do mês atual até o mais antigo, passando a virada do ano', () => {
    expect(mesesEntre('2025-11', '2026-02')).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
    expect(mesesEntre('2026-02', '2026-02')).toEqual(['2026-02']);
  });

  it('respeita o limite', () => {
    expect(mesesEntre('2000-01', '2026-10', 3)).toEqual(['2026-10', '2026-09', '2026-08']);
  });
});

describe('horário de Pimenta Bueno (UTC−4)', () => {
  it('dia, hora e início do dia', async () => {
    const { toISODate, horaLocal, inicioDoDia, diaDaSemana } = await import('./dates');
    expect(toISODate('2026-10-15T03:30:00Z')).toBe('2026-10-14');
    expect(toISODate('2026-10-15T04:00:00Z')).toBe('2026-10-15');
    expect(horaLocal('2026-10-15T12:30:00Z')).toBe('08:30');
    expect(inicioDoDia('2026-10-15')).toBe('2026-10-15T04:00:00.000Z');
    expect(diaDaSemana('2026-10-10')).toBe(6);
  });
});
