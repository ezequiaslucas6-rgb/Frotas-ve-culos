import { describe, expect, it } from 'vitest';
import { calcularConsumo, parseDecimalBR, type LancamentoConsumo } from './consumo';

const l = (id: string, km: number, litros: number, tanque_cheio = true, extra: Partial<LancamentoConsumo> = {}): LancamentoConsumo => ({
  id,
  km,
  litros,
  tanque_cheio,
  combustivel: 'diesel_s10',
  data_abastecimento: '2026-10-01',
  ...extra,
});

describe('parseDecimalBR', () => {
  it.each([
    ['40,5', 40.5],
    ['40.5', 40.5],
    ['1.234,56', 1234.56],
    ['1.234', 1234],
    ['R$ 239,60', 239.6],
    ['239', 239],
  ])('%s -> %d', (entrada, esperado) => {
    expect(parseDecimalBR(entrada)).toBe(esperado);
  });

  it('vazio vira undefined e texto inválido vira NaN', () => {
    expect(parseDecimalBR('  ')).toBeUndefined();
    expect(parseDecimalBR('abc')).toBeNaN();
  });
});

describe('calcularConsumo (tanque cheio a tanque cheio)', () => {
  it('o primeiro tanque cheio só abre o ciclo', () => {
    expect(calcularConsumo([l('a', 1000, 50)])).toEqual({ porLancamento: {}, media: null });
  });

  it('calcula km/l entre dois tanques cheios', () => {
    const r = calcularConsumo([l('b', 1500, 50), l('a', 1000, 40)]); // fora de ordem de propósito
    expect(r.porLancamento).toEqual({ b: 10 });
    expect(r.media).toBe(10);
  });

  it('soma os parciais do meio ao ciclo seguinte', () => {
    const r = calcularConsumo([l('a', 1000, 40), l('p', 1200, 20, false), l('b', 1600, 40)]);
    expect(r.porLancamento).toEqual({ b: 10 }); // 600 km / (20 + 40) L
  });

  it('parciais antes do primeiro tanque cheio são ignorados', () => {
    const r = calcularConsumo([l('p', 900, 30, false), l('a', 1000, 40), l('b', 1400, 50)]);
    expect(r.porLancamento).toEqual({ b: 8 });
  });

  it('média ponderada por litros e GNV fora do cálculo', () => {
    const r = calcularConsumo([
      l('a', 0, 10),
      l('b', 100, 10), // 10 km/l
      l('g', 150, 12, true, { combustivel: 'gnv' }),
      l('c', 400, 50), // 6 km/l
    ]);
    expect(r.porLancamento).toEqual({ b: 10, c: 6 });
    expect(r.media).toBeCloseTo(400 / 60);
  });
});
