import { describe, expect, it } from 'vitest';
import { kmAbaixoDaReferencia, referenciaDoKm } from './referencia';

describe('referência do KM no abastecimento', () => {
  it('com abastecimento anterior, vale o KM dele, mesmo que o veículo (checklist) esteja mais alto', () => {
    // último abastecimento a 124.500; o checklist de hoje registrou 125.300 no veículo
    const ref = referenciaDoKm({ km: 124_500, data: '2026-10-12' }, 125_300);
    expect(ref).toEqual({ km: 124_500, origem: 'abastecimento', data: '2026-10-12' });
    // abastecer a 125.250 (entre os dois) não é erro
    expect(kmAbaixoDaReferencia(125_250, '2026-10-22', '2026-10-22', ref)).toBe(false);
  });

  it('abaixo do último abastecimento é recusado hoje, mas aceito em lançamento retroativo', () => {
    const ref = referenciaDoKm({ km: 124_500, data: '2026-10-12' }, 125_300);
    expect(kmAbaixoDaReferencia(124_400, '2026-10-22', '2026-10-22', ref)).toBe(true);
    expect(kmAbaixoDaReferencia(124_400, '2026-10-21', '2026-10-22', ref)).toBe(false); // dia anterior
    expect(kmAbaixoDaReferencia(124_500, '2026-10-22', '2026-10-22', ref)).toBe(false); // igual
  });

  it('sem abastecimento anterior, o ponto de partida é o KM do veículo', () => {
    const ref = referenciaDoKm(null, 125_300);
    expect(ref).toEqual({ km: 125_300, origem: 'veiculo', data: null });
    expect(kmAbaixoDaReferencia(125_000, '2026-10-22', '2026-10-22', ref)).toBe(true);
  });
});
