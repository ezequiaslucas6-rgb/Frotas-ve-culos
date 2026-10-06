import { describe, expect, it } from 'vitest';
import { chavePosto, conferenciaDoCupom, montarAcompanhamento, paraCsv, type RegistroAbastecimento } from './acompanhamento';

let n = 0;
const reg = (extra: Partial<RegistroAbastecimento>): RegistroAbastecimento => ({
  id: `a${++n}`,
  veiculo_id: 'V1',
  motorista_id: 'M1',
  data_abastecimento: '2026-10-05',
  created_at: '2026-10-05T12:00:00Z',
  km: 1000,
  litros: 40,
  valor_bruto: 240,
  desconto: 0,
  valor_total: 240,
  preco_litro: 6,
  combustivel: 'diesel_s10',
  tanque_cheio: true,
  posto: 'AUTO POSTO PIMENTA BUENO LTDA',
  comprovante_url: 'f/v/cupom.jpg',
  observacao: null,
  leitura_cupom: null,
  veiculos: { placa: 'ABC1D23', modelo: 'Strada' },
  motoristas: { nome: 'Diogo' },
  ...extra,
});

describe('acompanhamento de abastecimentos', () => {
  const historico = [
    // antes do período: abre o ciclo
    reg({ id: 'h1', data_abastecimento: '2026-09-28', km: 1000, litros: 40 }),
    reg({ id: 'p1', data_abastecimento: '2026-10-02', km: 1400, litros: 40, valor_bruto: 260, desconto: 20, valor_total: 240, preco_litro: 6 }),
    reg({ id: 'p2', data_abastecimento: '2026-10-09', km: 1800, litros: 50, valor_bruto: 300, valor_total: 300, preco_litro: 6, posto: 'Auto Posto Pimenta Bueno', comprovante_url: null }),
    reg({ id: 'x1', veiculo_id: 'V2', motorista_id: null, motoristas: null, veiculos: { placa: 'DEF4G56', modelo: null }, data_abastecimento: '2026-10-03', km: 500, litros: 30, valor_total: 210, valor_bruto: 210, preco_litro: 7, combustivel: 'gasolina', posto: 'Posto Forte' }),
  ];

  it('só o período entra nas linhas; o km/l usa o histórico do veículo', () => {
    const a = montarAcompanhamento(historico, { de: '2026-10-01', ate: '2026-10-31' });
    expect(a.linhas.map((l) => l.id)).toEqual(['p2', 'x1', 'p1']);
    const p1 = a.linhas.find((l) => l.id === 'p1')!;
    expect(p1).toMatchObject({ kml: 10, kmDesdeAnterior: 400, valorBruto: 260, desconto: 20, valorPago: 240, precoBomba: 6.5 });
    expect(a.linhas.find((l) => l.id === 'p2')).toMatchObject({ kml: 8, kmDesdeAnterior: 400 });
  });

  it('totais do período: litros, pago, desconto, preço médio, km rodados, km/l e custo por km', () => {
    const a = montarAcompanhamento(historico, { de: '2026-10-01', ate: '2026-10-31' });
    expect(a.totais).toMatchObject({ quantidade: 3, litros: 120, valorPago: 750, desconto: 20, valorBruto: 770, kmRodados: 800 });
    expect(a.totais.precoMedio).toBeCloseTo(6.25);
    expect(a.totais.kml).toBeCloseTo(800 / 90);
    expect(a.totais.custoKm).toBeCloseTo(6.25 / (800 / 90));
    expect(a.semComprovante).toBe(1);
  });

  it('agrupa por veículo, motorista e posto (nomes do mesmo posto juntos)', () => {
    const a = montarAcompanhamento(historico, { de: '2026-10-01', ate: '2026-10-31' });
    expect(a.porVeiculo.map((g) => [g.nome, g.quantidade, g.valorPago])).toEqual([
      ['ABC1D23', 2, 540],
      ['DEF4G56', 1, 210],
    ]);
    expect(a.porMotorista.map((g) => g.nome)).toEqual(['Diogo', 'Sem motorista']);
    expect(a.porPosto.map((g) => [g.chave, g.quantidade])).toEqual([
      ['AUTO POSTO PIMENTA BUENO', 2],
      ['POSTO FORTE', 1],
    ]);
    expect(chavePosto('Auto Pôsto Pimenta Bueno Ltda.')).toBe('AUTO POSTO PIMENTA BUENO');
  });

  it('filtros: combustível, posto e situação', () => {
    const f = { de: '2026-10-01', ate: '2026-10-31' };
    expect(montarAcompanhamento(historico, { ...f, combustivel: 'gasolina' }).linhas.map((l) => l.id)).toEqual(['x1']);
    expect(montarAcompanhamento(historico, { ...f, posto: 'forte' }).linhas.map((l) => l.id)).toEqual(['x1']);
    expect(montarAcompanhamento(historico, { ...f, situacao: 'sem_comprovante' }).linhas.map((l) => l.id)).toEqual(['p2']);
    expect(montarAcompanhamento(historico, { ...f, situacao: 'manual' }).linhas).toHaveLength(3);
  });

  it('filtro de motorista não quebra o km/l: o ciclo usa o tanque cheio de outro motorista', () => {
    const lista = [
      reg({ id: 'm1', motorista_id: 'A', data_abastecimento: '2026-10-02', km: 1000, litros: 40 }),
      reg({ id: 'm2', motorista_id: 'B', data_abastecimento: '2026-10-04', km: 1300, litros: 30 }),
    ];
    const a = montarAcompanhamento(lista, { de: '2026-10-01', ate: '2026-10-31', motoristaId: 'B' });
    expect(a.linhas.map((l) => [l.id, l.kml])).toEqual([['m2', 10]]);
    expect(a.totais.kmRodados).toBe(300);
  });
});

describe('conferência do cupom no lançamento', () => {
  const leitura = {
    legivel: true, combustivel: 'diesel_s10', produto: 'DIESEL', litros: 40.35, preco_unitario: 8.08, valor_item: null, desconto_item: null,
    valor_liquido_item: 289.71, valor_total_nota: 326.03, desconto_nota: 36.32, acrescimo_nota: 0, valor_a_pagar: 289.71, outros_itens: false,
    data: '2026-09-21', posto: 'AUTO POSTO', cnpj: null, placa: 'QTG2489', km: 212855, observacao: null,
  };
  const registro = { modelo: 'gemini-flash-latest', lido_em: '2026-09-21T12:00:00Z', leitura };
  const base = { litros: 40.35, valor_bruto: 326.03, desconto: 36.32, valor_total: 289.71, veiculos: { placa: 'QTG2489', modelo: null } };

  it('lido e conferido; placa confere', () => {
    expect(conferenciaDoCupom(reg({ ...base, leitura_cupom: registro }))).toMatchObject({
      origem: 'leitura', conferido: true, editado: false, placaConfere: true, kmCupom: 212855,
    });
  });

  it('valores mudados depois da leitura e placa de outro veículo aparecem para conferir', () => {
    const c = conferenciaDoCupom(reg({ ...base, litros: 45.35, leitura_cupom: registro, veiculos: { placa: 'ABC1D23', modelo: null } }));
    expect(c).toMatchObject({ editado: true, placaConfere: false });
  });

  it('sem leitura: digitado à mão', () => {
    expect(conferenciaDoCupom(reg({}))).toMatchObject({ origem: 'manual' });
  });
});

describe('planilha (CSV)', () => {
  it('separador ;, vírgula decimal, BOM e texto com ; entre aspas', () => {
    const a = montarAcompanhamento([reg({ id: 'c1', observacao: 'pago; nota "2"', data_abastecimento: '2026-10-05' })], { de: '2026-10-01', ate: '2026-10-31' });
    const csv = paraCsv(a.linhas);
    expect(csv.startsWith('﻿Data;Registrado em;Placa')).toBe(true);
    const linha = csv.split('\r\n')[1]!;
    expect(linha).toContain('05/10/2026;');
    expect(linha).toContain(';40,000;');
    expect(linha).toContain(';240,00;');
    expect(linha).toContain('"pago; nota ""2"""');
  });
});
