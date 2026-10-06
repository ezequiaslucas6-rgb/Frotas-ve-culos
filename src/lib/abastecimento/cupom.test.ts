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
    expect(c.avisos[0]).toMatch(/diferença entre o valor total e o valor a pagar/);
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
      desconto_nota: -3,
      data: '06/10/2026',
      posto: '  AUTO POSTO  ',
      km: '48200',
    });
    expect(l).toMatchObject({
      legivel: true,
      combustivel: null,
      litros: 45.32,
      valor_item: 280.53,
      desconto_nota: null,
      data: null,
      posto: 'AUTO POSTO',
      km: 48200,
      outros_itens: false,
      valor_a_pagar: null,
    });
    expect(leituraCupomSchema.parse({}).legivel).toBe(false);
  });
});
