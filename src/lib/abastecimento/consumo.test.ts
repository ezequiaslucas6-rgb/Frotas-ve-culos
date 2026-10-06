import { describe, expect, it } from 'vitest';
import { calcularConsumo, descreverAnomalia, detectarConsumoAnormal, parseDecimalBR, type LancamentoConsumo } from './consumo';

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

  it('usa só o KM dos abastecimentos: o checklist (100 km) não entra, o tanque cheio a 102 km fecha o ciclo', () => {
    // tanque cheio a 0 km; checklist registra 100 km (não é lançamento de consumo);
    // anda 2 km até o posto e enche o tanque a 102 km com 10 L: 102 km / 10 L
    const r = calcularConsumo([l('a', 0, 40), l('b', 102, 10)]);
    expect(r.porLancamento).toEqual({ b: 10.2 });
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

describe('detectarConsumoAnormal', () => {
  // ciclos de 500 km: litros definem o km/l (500/50 = 10 km/l)
  const serie = (litrosPorCiclo: number[], combustivel: LancamentoConsumo['combustivel'] = 'diesel_s10') =>
    [{ id: 'base', km: 10_000, litros: 50, tanque_cheio: true, combustivel, data_abastecimento: '2026-01-01' }].concat(
      litrosPorCiclo.map((litros, i) => ({
        id: `c${i + 1}`,
        km: 10_000 + 500 * (i + 1),
        litros,
        tanque_cheio: true,
        combustivel,
        data_abastecimento: `2026-01-${String(i + 2).padStart(2, '0')}`,
      })),
    );

  it('sem referência suficiente (menos de 2 ciclos normais) não acusa nada', () => {
    expect(detectarConsumoAnormal(serie([50, 80]))).toEqual({ porLancamento: {}, ultima: null });
  });

  it('queda de 25% ou mais (vazamento/desvio) é acusada; o último ciclo vira o alerta do painel', () => {
    const r = detectarConsumoAnormal(serie([50, 50, 50, 70])); // 10, 10, 10 -> 7,14 km/l (-28,6%)
    expect(Object.keys(r.porLancamento)).toEqual(['c4']);
    expect(r.ultima).toMatchObject({ id: 'c4', tipo: 'queda', referencia: 10 });
    expect(r.ultima!.variacao).toBeCloseTo(-0.2857, 3);
    expect(descreverAnomalia(r.ultima!)).toBe('29% abaixo do normal');
  });

  it('variação pequena é normal (e entra na referência)', () => {
    expect(detectarConsumoAnormal(serie([50, 50, 55, 60])).ultima).toBeNull(); // 9,1 e 8,3 km/l: -9% e -17%
  });

  it('km/l alto demais aponta hodômetro suspeito', () => {
    const r = detectarConsumoAnormal(serie([50, 50, 30])); // 16,7 km/l: +67%
    expect(r.ultima).toMatchObject({ id: 'c3', tipo: 'alta' });
  });

  it('ciclo anormal não contamina a referência; depois dele, o normal volta a ser normal', () => {
    const r = detectarConsumoAnormal(serie([50, 50, 80, 50]));
    expect(Object.keys(r.porLancamento)).toEqual(['c3']);
    expect(r.ultima).toBeNull();
  });

  it('compara com o mesmo combustível (etanol rende menos que gasolina sem ser alerta)', () => {
    const gasolina = serie([50, 50], 'gasolina');
    const etanol = { id: 'e1', km: 11_500, litros: 70, tanque_cheio: true, combustivel: 'etanol' as const, data_abastecimento: '2026-01-10' };
    expect(detectarConsumoAnormal([...gasolina, etanol]).ultima).toBeNull();
  });
});
