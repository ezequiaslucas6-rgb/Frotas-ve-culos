import { describe, expect, it } from 'vitest';
import { descreverSituacaoCnh, situacaoCnh } from './cnh';

describe('situacaoCnh', () => {
  const hoje = '2026-10-02';

  it('sem validade informada', () => {
    expect(situacaoCnh(null, hoje)).toEqual({ nivel: 'sem_dados' });
  });

  it('vencida a partir do dia seguinte à validade', () => {
    expect(situacaoCnh('2026-10-01', hoje)).toMatchObject({ nivel: 'vencida', dias: -1 });
    expect(descreverSituacaoCnh(situacaoCnh('2026-09-22', hoje))).toBe('Vencida há 10 dias');
  });

  it('em alerta até 30 dias antes (vencer hoje ainda vale hoje)', () => {
    expect(situacaoCnh('2026-10-02', hoje)).toMatchObject({ nivel: 'vence', dias: 0 });
    expect(descreverSituacaoCnh(situacaoCnh('2026-10-02', hoje))).toBe('Vence hoje');
    expect(situacaoCnh('2026-11-01', hoje)).toMatchObject({ nivel: 'vence', dias: 30 });
  });

  it('em dia com mais de 30 dias', () => {
    expect(situacaoCnh('2026-11-02', hoje)).toMatchObject({ nivel: 'ok', dias: 31 });
  });
});
