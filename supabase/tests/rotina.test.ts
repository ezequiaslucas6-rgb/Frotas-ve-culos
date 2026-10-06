/**
 * Rotina dos checklists (migration 20260109): decisão diária do supervisor para veículo sem
 * checklist diário, colunas novas da view do painel e as fotos da carcaça dos retrovisores.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarBanco } from './banco';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const SUP_SP = '00000000-0000-4000-8000-0000000000b1';
const SUP_RJ = '00000000-0000-4000-8000-0000000000b2';
const DRV = '00000000-0000-4000-8000-0000000000c1';
const F_SP = '10000000-0000-4000-8000-000000000001';
const F_RJ = '10000000-0000-4000-8000-000000000002';
const V_1 = '20000000-0000-4000-8000-000000000001'; // responsável: M_1
const V_2 = '20000000-0000-4000-8000-000000000002';
const M_1 = '30000000-0000-4000-8000-000000000001';

const SEMANAL = [
  'frente', 'traseira', 'lateral_esquerda', 'lateral_direita',
  'pneu_dianteiro_esquerdo', 'pneu_dianteiro_direito', 'pneu_traseiro_esquerdo', 'pneu_traseiro_direito',
  'retrovisor_esquerdo', 'retrovisor_direito', 'retrovisor_esquerdo_carcaca', 'retrovisor_direito_carcaca',
  'nivel_oleo', 'fluido_freio', 'nivel_agua', 'painel', 'bancos',
  'luzes_sinalizacao', 'para_brisa', 'estepe', 'carroceria_portamalas',
];

let db: PGlite;
let as: Awaited<ReturnType<typeof criarBanco>>['as'];
let rows: Awaited<ReturnType<typeof criarBanco>>['rows'];

const decidir = (veiculo: string, liberado: boolean, obs: string | null = null) =>
  db.query('select public.decidir_liberacao_diaria($1, $2, $3)', [veiculo, liberado, obs]);
const painel = (veiculo: string) =>
  rows<{ liberacao_diaria: boolean | null; liberacao_diaria_obs: string | null; ultimo_semanal_em: string | null; ultimo_mensal_em: string | null }>(
    'select liberacao_diaria, liberacao_diaria_obs, ultimo_semanal_em, ultimo_mensal_em from public.vw_veiculos_painel where id = $1',
    [veiculo],
  ).then((r) => r[0]!);

beforeAll(async () => {
  ({ db, as, rows } = await criarBanco());
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@x.com'), ('${SUP_SP}', 'sp@x.com'), ('${SUP_RJ}', 'rj@x.com'), ('${DRV}', 'diogo@x.com');
    insert into public.filiais (id, nome_cidade, uf) values ('${F_SP}', 'Pimenta Bueno', 'RO'), ('${F_RJ}', 'Cacoal', 'RO');
    insert into public.profiles (id, nome, role, filial_id) values
      ('${ADMIN}', 'Admin', 'admin', null), ('${SUP_SP}', 'Sup PB', 'supervisor', '${F_SP}'),
      ('${SUP_RJ}', 'Sup CC', 'supervisor', '${F_RJ}'), ('${DRV}', 'Diogo', 'motorista', '${F_SP}');
    insert into public.motoristas (id, filial_id, nome, cpf, email, whatsapp, cnh, user_id) values
      ('${M_1}', '${F_SP}', 'Diogo', '52998224725', 'diogo@x.com', '5511999990001', '22522791508', '${DRV}');
    insert into public.veiculos (id, filial_id, placa, km_atual, motorista_id) values
      ('${V_1}', '${F_SP}', 'ABC1D23', 1000, '${M_1}'), ('${V_2}', '${F_SP}', 'DEF4G56', 2000, null);
  `);
});

describe('carcaça dos retrovisores', () => {
  it('é foto obrigatória nos três tipos de checklist', async () => {
    const r = await rows<{ tipo: string; n: number }>(
      `select tipo::text, count(*)::int as n from public.checklist_modelo
        where item in ('retrovisor_esquerdo_carcaca', 'retrovisor_direito_carcaca') group by tipo order by tipo`,
    );
    expect(r).toEqual([
      { tipo: 'diario', n: 2 },
      { tipo: 'mensal', n: 2 },
      { tipo: 'semanal', n: 2 },
    ]);
  });

  it('checklist sem a foto da carcaça é recusado', async () => {
    const id = '40000000-0000-4000-8000-000000000099';
    const fotos = SEMANAL.filter((c) => c !== 'retrovisor_direito_carcaca').map((c) => ({
      categoria_foto: c, foto_url: `${F_SP}/${id}/${c}.jpg`, severidade: 'ok', observacao: null, marcadores: [],
    }));
    await expect(
      as(SUP_SP, () =>
        db.query(`select public.salvar_checklist($1, 'semanal'::public.checklist_tipo, $2, $3, null, 1100, $4::jsonb, '{}'::jsonb)`, [
          id, V_1, M_1, JSON.stringify(fotos),
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe('decisão diária do supervisor', () => {
  it('o supervisor de outra filial e o motorista não decidem', async () => {
    await expect(as(SUP_RJ, () => decidir(V_1, true))).rejects.toThrow(/supervisor da filial/);
    await expect(as(DRV, () => decidir(V_1, true))).rejects.toThrow(/supervisor da filial/);
  });

  it('o supervisor da filial decide (e pode mudar a decisão no mesmo dia)', async () => {
    await as(SUP_SP, () => decidir(V_1, false, 'Sem checklist, aguardar o motorista'));
    expect(await painel(V_1)).toMatchObject({ liberacao_diaria: false, liberacao_diaria_obs: 'Sem checklist, aguardar o motorista' });
    await as(SUP_SP, () => decidir(V_1, true));
    expect(await painel(V_1)).toMatchObject({ liberacao_diaria: true, liberacao_diaria_obs: null });
    expect(await rows('select * from public.liberacoes_diarias')).toHaveLength(1);
  });

  it('o admin decide em qualquer filial; ninguém grava direto na tabela', async () => {
    await as(ADMIN, () => decidir(V_2, false));
    expect((await painel(V_2)).liberacao_diaria).toBe(false);
    await expect(
      as(SUP_SP, () => db.query(`insert into public.liberacoes_diarias (veiculo_id, filial_id, dia, liberado) values ($1, $2, current_date, true)`, [V_2, F_SP])),
    ).rejects.toThrow();
  });

  it('o motorista vê a decisão do próprio veículo; o supervisor de outra filial não vê nada', async () => {
    const doMotorista = await as(DRV, () => rows<{ veiculo_id: string }>('select veiculo_id from public.liberacoes_diarias'));
    expect(doMotorista.map((r) => r.veiculo_id)).toEqual([V_1]);
    expect(await as(SUP_RJ, () => rows('select * from public.liberacoes_diarias'))).toHaveLength(0);
  });

  it('decisão de outro dia não aparece como a de hoje', async () => {
    await db.exec(`update public.liberacoes_diarias set dia = dia - 1 where veiculo_id = '${V_2}'`);
    expect((await painel(V_2)).liberacao_diaria).toBeNull();
  });
});

describe('view do painel: último semanal e mensal', () => {
  it('o mensal também conta como semanal', async () => {
    await db.exec(`
      insert into public.checklists (id, veiculo_id, filial_id, motorista_id, supervisor_id, tipo, status, data_envio) values
        ('40000000-0000-4000-8000-000000000001', '${V_2}', '${F_SP}', '${M_1}', '${SUP_SP}', 'diario', 'ok', '2026-10-12T12:00:00Z'),
        ('40000000-0000-4000-8000-000000000002', '${V_2}', '${F_SP}', '${M_1}', '${SUP_SP}', 'mensal', 'ok', '2026-10-10T12:00:00Z'),
        ('40000000-0000-4000-8000-000000000003', '${V_2}', '${F_SP}', '${M_1}', '${SUP_SP}', 'semanal', 'ok', '2026-10-03T12:00:00Z');
    `);
    const p = await painel(V_2);
    expect(new Date(p.ultimo_semanal_em!).toISOString()).toBe('2026-10-10T12:00:00.000Z');
    expect(new Date(p.ultimo_mensal_em!).toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });
});
