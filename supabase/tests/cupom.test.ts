/**
 * Nota de abastecimento (migration 20260108): valor total (bruto), desconto e valor líquido.
 * valor_total = líquido = bruto − desconto; preco_litro (gerado) = preço por litro com desconto.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarBanco } from './banco';

const SUP_SP = '00000000-0000-4000-8000-0000000000b1';
const F_SP = '10000000-0000-4000-8000-000000000001';
const V_1 = '20000000-0000-4000-8000-000000000001';

const SEMENTE = `
  insert into auth.users (id, email) values ('${SUP_SP}', 'sp@x.com');
  insert into public.filiais (id, nome_cidade, uf) values ('${F_SP}', 'São Paulo', 'SP');
  insert into public.profiles (id, nome, role, filial_id) values ('${SUP_SP}', 'Sup SP', 'supervisor', '${F_SP}');
  insert into public.veiculos (id, filial_id, placa, km_atual) values ('${V_1}', '${F_SP}', 'ABC1D23', 1000);
`;

let db: PGlite;
let as: Awaited<ReturnType<typeof criarBanco>>['as'];

const lancar = (campos: { km: number; litros: number; valor_total: number; valor_bruto?: number | null; desconto?: number; leitura?: unknown }) =>
  db.query<{ preco_litro: string; valor_bruto: string | null; desconto: string; valor_total: string }>(
    `insert into public.abastecimentos (veiculo_id, filial_id, km, litros, valor_total, valor_bruto, desconto, leitura_cupom, combustivel)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'gasolina') returning preco_litro, valor_bruto, desconto, valor_total`,
    [V_1, F_SP, campos.km, campos.litros, campos.valor_total, campos.valor_bruto ?? null, campos.desconto ?? 0, campos.leitura === undefined ? null : JSON.stringify(campos.leitura)],
  );

beforeAll(async () => {
  ({ db, as } = await criarBanco());
  await db.exec(SEMENTE);
});

describe('valor total, desconto e líquido', () => {
  it('preço por litro gravado já é o com desconto (líquido ÷ litros)', async () => {
    await as(SUP_SP, async () => {
      const { rows: [r] } = await lancar({ km: 1100, litros: 45.32, valor_bruto: 280.53, desconto: 13.6, valor_total: 266.93, leitura: { litros: 45.32 } });
      expect(r).toEqual({ preco_litro: '5.890', valor_bruto: '280.53', desconto: '13.60', valor_total: '266.93' });
    });
  });

  it('lançamento sem valor total separado continua valendo (sem desconto)', async () => {
    await as(SUP_SP, async () => {
      const { rows: [r] } = await lancar({ km: 1200, litros: 40, valor_total: 239.6 });
      expect(r).toEqual({ preco_litro: '5.990', valor_bruto: null, desconto: '0.00', valor_total: '239.60' });
    });
  });

  it('recusa contas que não fecham, desconto sem valor total e desconto maior que o total', async () => {
    await as(SUP_SP, async () => {
      await expect(lancar({ km: 1300, litros: 45.32, valor_bruto: 280.53, desconto: 13.6, valor_total: 280.53 })).rejects.toThrow(/abastecimentos_desconto_ck/);
      await expect(lancar({ km: 1300, litros: 40, valor_total: 230, desconto: 10 })).rejects.toThrow(/abastecimentos_desconto_ck/);
      await expect(lancar({ km: 1300, litros: 40, valor_bruto: 100, desconto: 100, valor_total: 0.01 })).rejects.toThrow(/abastecimentos_desconto_ck|valor_total_check/);
      await expect(lancar({ km: 1300, litros: 40, valor_bruto: 100, desconto: -1, valor_total: 101 })).rejects.toThrow(/abastecimentos_desconto_ck/);
    });
  });

  it('a leitura do cupom é um objeto pequeno', async () => {
    await as(SUP_SP, async () => {
      await expect(lancar({ km: 1300, litros: 40, valor_total: 239.6, leitura: [1, 2] })).rejects.toThrow(/abastecimentos_leitura_ck/);
      await expect(lancar({ km: 1300, litros: 40, valor_total: 239.6, leitura: { texto: 'x'.repeat(10_000) } })).rejects.toThrow(/abastecimentos_leitura_ck/);
    });
  });
});

describe('atualização (20260108) com lançamentos antigos', () => {
  it('os lançamentos existentes ficam sem valor total separado e sem desconto', async () => {
    const antigo = await criarBanco({ antesDe: '20260108000000_cupom_abastecimento.sql' });
    await antigo.db.exec(SEMENTE);
    await antigo.db.query(
      `insert into public.abastecimentos (veiculo_id, filial_id, km, litros, valor_total, combustivel) values ($1, $2, 1100, 50, 300, 'gasolina')`,
      [V_1, F_SP],
    );
    await antigo.aplicarPendentes();
    expect(await antigo.rows('select valor_bruto, desconto, valor_total, preco_litro from public.abastecimentos')).toEqual([
      { valor_bruto: null, desconto: '0.00', valor_total: '300.00', preco_litro: '6.000' },
    ]);
  });
});
