import { describe, expect, it } from 'vitest';
import { calcularCupom, calcularValores, type LeituraCupom } from './cupom';

const base: LeituraCupom = {
  legivel: true,
  combustivel: 'gasolina',
  produto: 'GASOLINA C COMUM',
  litros: null,
  preco_unitario: null,
  valor_item: null,
  desconto_item: null,
  valor_liquido_item: null,
  valor_total_nota: null,
  desconto_nota: null,
  acrescimo_nota: null,
  valor_a_pagar: null,
  outros_itens: false,
  data: '2026-10-06',
  posto: 'AUTO POSTO EXEMPLO LTDA',
  cnpj: null,
  placa: null,
  km: null,
  observacao: null,
};

describe('contas do lançamento (também à mão)', () => {
  it('líquido = total − desconto; unitário com desconto = líquido ÷ litros', () => {
    expect(calcularValores({ litros: 45.32, valorBruto: 280.53, desconto: 13.6 })).toEqual({
      desconto: 13.6,
      valorLiquido: 266.93,
      unitarioComDesconto: 5.89,
      precoBomba: 6.19,
    });
    expect(calcularValores({ litros: 40, valorBruto: 239.6 })).toMatchObject({ desconto: 0, valorLiquido: 239.6, unitarioComDesconto: 5.99 });
    expect(calcularValores({ litros: null, valorBruto: 100 }).unitarioComDesconto).toBeNull();
  });
});

describe('leitura do cupom', () => {
  it('NFC-e com desconto: calcula e confere tudo', () => {
    const c = calcularCupom({
      ...base,
      litros: 45.32,
      preco_unitario: 6.19,
      valor_item: 280.53,
      valor_total_nota: 280.53,
      desconto_nota: 13.6,
      valor_a_pagar: 266.93,
    });
    expect(c).toMatchObject({ litros: 45.32, valorBruto: 280.53, desconto: 13.6, valorAPagar: 266.93, valorLiquido: 266.93, unitarioComDesconto: 5.89, precoBomba: 6.19, confiavel: true });
    expect(c.conferencias.map((x) => x.ok)).toEqual([true, true]);
    expect(c.avisos).toEqual([]);
  });

  it('desconto que não vem escrito sai da diferença entre o total e o valor a pagar', () => {
    const c = calcularCupom({ ...base, litros: 50, preco_unitario: 6.09, valor_total_nota: 304.5, valor_a_pagar: 294.5 });
    expect(c).toMatchObject({ desconto: 10, valorLiquido: 294.5, unitarioComDesconto: 5.89 });
    expect(c.avisos[0]).toMatch(/diferença entre o valor total e o valor pago/);
  });

  it('número lido errado não passa na conferência', () => {
    // 45,32 × 6,19 = 280,53, mas a leitura trouxe 230,53
    const c = calcularCupom({ ...base, litros: 45.32, preco_unitario: 6.19, valor_item: 230.53, valor_total_nota: 230.53, desconto_nota: 13.6, valor_a_pagar: 216.93 });
    expect(c.confiavel).toBe(false);
    expect(c.conferencias[0]).toMatchObject({ ok: false });
    expect(c.conferencias[0]!.texto).toMatch(/R\$\s280,53/);
  });

  it('valor a pagar que não bate com total − desconto', () => {
    const c = calcularCupom({ ...base, litros: 45.32, preco_unitario: 6.19, valor_item: 280.53, desconto_nota: 13.6, valor_a_pagar: 266.39 });
    expect(c.conferencias.map((x) => x.ok)).toEqual([true, false]);
    expect(c.confiavel).toBe(false);
  });

  it('nota com outros produtos: desconto da nota dividido pelo valor do combustível', () => {
    const c = calcularCupom({
      ...base,
      outros_itens: true,
      litros: 100,
      preco_unitario: 5.99,
      valor_item: 599,
      valor_total_nota: 699, // + ARLA 100,00
      desconto_nota: 20,
      valor_a_pagar: 679,
    });
    // 20 × 599/699 = 17,14
    expect(c).toMatchObject({ valorBruto: 599, desconto: 17.14, valorLiquido: 581.86, unitarioComDesconto: 5.819 });
    expect(c.avisos.join(' ')).toMatch(/dividido proporcionalmente/);
    expect(c.avisos.join(' ')).toMatch(/outros produtos/);
  });

  it('desconto impresso na linha do combustível tem preferência', () => {
    const c = calcularCupom({ ...base, outros_itens: true, litros: 30, preco_unitario: 6, valor_item: 180, desconto_item: 6, valor_total_nota: 250, desconto_nota: 10 });
    expect(c).toMatchObject({ desconto: 6, valorLiquido: 174, unitarioComDesconto: 5.8 });
  });

  it('sem valor total: usa litros × preço e avisa', () => {
    const c = calcularCupom({ ...base, outros_itens: true, litros: 20, preco_unitario: 5.9 });
    expect(c.valorBruto).toBe(118);
    expect(c.avisos[0]).toMatch(/calculado por litros × preço/);
    expect(c.confiavel).toBe(false);
  });

  it('foto ilegível ou preço absurdo geram aviso', () => {
    expect(calcularCupom({ ...base, legivel: false }).avisos[0]).toMatch(/não parece um cupom/);
    const c = calcularCupom({ ...base, litros: 4.532, valor_item: 280.53, valor_a_pagar: 280.53 });
    expect(c.avisos.join(' ')).toMatch(/Preço por litro fora do comum/);
  });
});

describe('leitura vinda da IA (tolerante)', () => {
  it('números em texto viram número; campo estranho vira null; nunca derruba', async () => {
    const { leituraCupomSchema } = await import('./cupom');
    const l = leituraCupomSchema.parse({
      legivel: true,
      combustivel: 'querosene',
      litros: '45,320',
      preco_unitario: 6.19,
      valor_item: 'R$ 280,53',
      desconto_nota: -3, // impresso com sinal
      data: '06/10/2026',
      posto: '  AUTO POSTO  ',
      km: '48200',
    });
    expect(l).toMatchObject({
      legivel: true,
      combustivel: null,
      litros: 45.32,
      valor_item: 280.53,
      desconto_nota: 3,
      data: null,
      posto: 'AUTO POSTO',
      km: 48200,
      outros_itens: false,
      valor_a_pagar: null,
    });
    expect(leituraCupomSchema.parse({}).legivel).toBe(false);
  });
});

/*
 * Modelos de nota reais da frota (valores transcritos das fotos enviadas):
 *  - NFC-e xpert do Posto Minuano: "5.413 LT" (ponto decimal), desconto e valor líquido na linha, placa e KM no rodapé
 *  - DANFE A4 do Auto Posto Pimenta Bueno: "% DESCONTO", VALOR LÍQUIDO na linha, total dos produtos x total da nota
 *  - NFC-e xpert do Posto Forte: sem desconto, "19.737 LT", "KM: 0", recibo manual atrás
 */
describe('modelos de nota da frota', () => {
  const minuano: LeituraCupom = {
    ...base,
    combustivel: 'gasolina',
    produto: 'GASOLINA COMUM ORIGINAL',
    litros: 5.413,
    preco_unitario: 7.39,
    valor_item: 40,
    desconto_item: 2.27,
    valor_liquido_item: 37.73,
    valor_total_nota: 40,
    desconto_nota: 2.27,
    acrescimo_nota: 0,
    valor_a_pagar: 37.73,
    data: '2026-09-28',
    posto: 'POSTO MINUANO',
    cnpj: '14.017.058/0001-52',
    placa: 'RSV2A77',
    km: 68668,
  };
  const danfe: LeituraCupom = {
    ...base,
    combustivel: 'diesel_s10',
    produto: 'OLEO DIESEL B S10 ADIT PETROBRAS GRID',
    litros: 40.35,
    preco_unitario: 8.08,
    valor_item: null,
    valor_liquido_item: 289.71,
    valor_total_nota: 326.03,
    desconto_nota: 36.32,
    acrescimo_nota: 0,
    valor_a_pagar: 289.71,
    data: '2026-09-21',
    posto: 'AUTO POSTO PIMENTA BUENO LTDA',
    cnpj: '04.380.678/0001-06',
    placa: 'QTG2489',
    km: 212855,
  };
  const forte: LeituraCupom = {
    ...base,
    combustivel: 'diesel_s10',
    produto: 'DIESEL S10 COMUM',
    litros: 19.737,
    preco_unitario: 7.6,
    valor_item: 150,
    valor_total_nota: 150,
    desconto_nota: 0,
    acrescimo_nota: 0,
    valor_a_pagar: 150,
    data: '2026-08-27',
    posto: 'POSTO FORTE',
    cnpj: '07.646.667/0001-05',
  };

  it('Minuano (NFC-e com desconto na linha): R$ 37,73 líquido, R$ 6,97/L', () => {
    const c = calcularCupom(minuano);
    expect(c).toMatchObject({ litros: 5.413, valorBruto: 40, desconto: 2.27, valorAPagar: 37.73, valorLiquido: 37.73, unitarioComDesconto: 6.97, confiavel: true });
    expect(c.conferencias.map((x) => x.texto)).toEqual(['Litros × preço da bomba = valor total', 'Valor total − desconto = valor líquido']);
    expect(c.avisos).toEqual([]);
  });

  it('Minuano lido com "5.413" como cinco mil litros: a quantidade é corrigida', () => {
    const c = calcularCupom({ ...minuano, litros: 5413 });
    expect(c).toMatchObject({ litros: 5.413, unitarioComDesconto: 6.97, confiavel: true });
    expect(c.avisos[0]).toMatch(/Quantidade lida como 5,413 L/);
  });

  it('DANFE (A4): R$ 326,03 − R$ 36,32 = R$ 289,71; R$ 7,18/L', () => {
    const c = calcularCupom(danfe);
    expect(c).toMatchObject({ litros: 40.35, valorBruto: 326.03, desconto: 36.32, valorAPagar: 289.71, valorLiquido: 289.71, unitarioComDesconto: 7.18, confiavel: true });
    expect(c.conferencias.every((x) => x.ok)).toBe(true);
    expect(c.avisos).toEqual([]);
  });

  it('DANFE com a porcentagem (11,14) lida como desconto: vale o desconto que fecha com o valor líquido', () => {
    const c = calcularCupom({ ...danfe, desconto_item: 11.14 });
    expect(c).toMatchObject({ desconto: 36.32, valorLiquido: 289.71, confiavel: true });
    expect(c.avisos[0]).toMatch(/não fecha com o valor pago: usado R\$\s36,32/);
  });

  it('DANFE com o "valor total da nota" (já com desconto) lido como valor total: corrigido', () => {
    const c = calcularCupom({ ...danfe, valor_total_nota: 289.71 });
    expect(c).toMatchObject({ valorBruto: 326.03, desconto: 36.32, valorLiquido: 289.71, unitarioComDesconto: 7.18, confiavel: true });
    expect(c.avisos[0]).toMatch(/já era o valor com desconto/);
  });

  it('Posto Forte (sem desconto): R$ 150,00 e R$ 7,60/L', () => {
    const c = calcularCupom(forte);
    expect(c).toMatchObject({ litros: 19.737, valorBruto: 150, desconto: 0, valorLiquido: 150, unitarioComDesconto: 7.6, confiavel: true });
    expect(c.avisos).toEqual([]);
  });

  it('desconto impresso com sinal, placa com hífen e "KM: 0" chegam limpos', async () => {
    const { leituraCupomSchema } = await import('./cupom');
    const l = leituraCupomSchema.parse({ ...minuano, desconto_item: -2.27, desconto_nota: '-2,27', placa: 'rsv-2a77', km: 0 });
    expect(l).toMatchObject({ desconto_item: 2.27, desconto_nota: 2.27, placa: 'RSV2A77', km: null });
    expect(leituraCupomSchema.parse({ ...forte, placa: '', km: '0' })).toMatchObject({ placa: null, km: null });
  });
});

describe('placa do cupom', () => {
  it('confere com o veículo escolhido (com ou sem hífen); sem placa no cupom, não confere nada', async () => {
    const { conferirPlaca } = await import('./cupom');
    expect(conferirPlaca('RSV2A77', 'rsv-2a77')).toEqual({ ok: true, texto: 'Placa do cupom = veículo escolhido (RSV2A77)' });
    expect(conferirPlaca('QTG2489', 'ABC1D23')).toMatchObject({ ok: false });
    expect(conferirPlaca('QTG2489', 'ABC1D23')!.texto).toMatch(/placa no cupom é QTG2489, mas o veículo escolhido é ABC1D23/);
    expect(conferirPlaca(null, 'ABC1D23')).toBeNull();
  });
});
