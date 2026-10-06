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
