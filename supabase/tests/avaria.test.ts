/**
 * Avaria crítica no checklist => manutenção corretiva aberta + veículo "não liberado"
 * (migration 20260107). Liberação por conserto (concluir a manutenção) ou pelo responsável.
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

const DIARIO = [
  'frente', 'traseira', 'lateral_esquerda', 'lateral_direita',
  'pneu_dianteiro_esquerdo', 'pneu_dianteiro_direito', 'pneu_traseiro_esquerdo', 'pneu_traseiro_direito',
  'retrovisor_esquerdo', 'retrovisor_direito', 'nivel_oleo', 'fluido_freio', 'nivel_agua', 'painel', 'bancos',
];
const ck = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let db: PGlite;
let as: Awaited<ReturnType<typeof criarBanco>>['as'];
let rows: Awaited<ReturnType<typeof criarBanco>>['rows'];

/** Checklist diário; `avarias` = item -> descrição (severidade crítica); `vazamento` = resposta Sim com foto crítica. */
const salvar = (id: string, veiculo: string, km: number, avarias: Record<string, string> = {}, vazamento?: string) => {
  const itens = vazamento ? [...DIARIO, 'vazamento_avaria'] : DIARIO;
  const fotos = itens.map((c) => {
    const obs = c === 'vazamento_avaria' ? vazamento : avarias[c];
    return { categoria_foto: c, foto_url: `${F_SP}/${id}/${c}.jpg`, severidade: obs ? 'critico' : 'ok', observacao: obs ?? null, marcadores: [] };
  });
  return db.query(
    `select public.salvar_checklist($1, 'diario'::public.checklist_tipo, $2, $3, null, $4, $5::jsonb, $6::jsonb)`,
    [id, veiculo, M_1, km, JSON.stringify(fotos), JSON.stringify({ vazamento_avaria: Boolean(vazamento) })],
  );
};
const painel = (veiculo: string) =>
  rows<{ bloqueio_id: string | null; manutencoes_abertas: number; ultima_corretiva_em: string | null; ultima_liberacao_em: string | null }>(
    'select bloqueio_id, manutencoes_abertas, ultima_corretiva_em, ultima_liberacao_em from public.vw_veiculos_painel where id = $1',
    [veiculo],
  ).then((r) => r[0]!);
const abertas = (veiculo: string) =>
  rows<{ id: string; descricao: string; custo: string; tipo: string; checklist_id: string; created_by: string }>(
    `select id, descricao, custo, tipo, checklist_id, created_by from public.manutencoes where veiculo_id = $1 and situacao = 'aberta'`,
    [veiculo],
  );
const bloqueios = (veiculo: string) =>
  rows<{ liberado_em: string | null; liberacao: string | null; liberacao_obs: string | null; liberado_por: string | null }>(
    'select liberado_em, liberacao, liberacao_obs, liberado_por from public.veiculo_bloqueios where veiculo_id = $1 order by bloqueado_em',
    [veiculo],
  );

beforeAll(async () => {
  ({ db, as, rows } = await criarBanco());
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@x.com'), ('${SUP_SP}', 'sp@x.com'), ('${SUP_RJ}', 'rj@x.com'), ('${DRV}', 'diogo@x.com');
    insert into public.filiais (id, nome_cidade, uf) values ('${F_SP}', 'São Paulo', 'SP'), ('${F_RJ}', 'Rio de Janeiro', 'RJ');
    insert into public.profiles (id, nome, role, filial_id) values
      ('${ADMIN}', 'Admin', 'admin', null), ('${SUP_SP}', 'Sup SP', 'supervisor', '${F_SP}'),
      ('${SUP_RJ}', 'Sup RJ', 'supervisor', '${F_RJ}'), ('${DRV}', 'Diogo', 'motorista', '${F_SP}');
    insert into public.motoristas (id, filial_id, nome, cpf, email, whatsapp, cnh, user_id) values
      ('${M_1}', '${F_SP}', 'Diogo', '52998224725', 'diogo@x.com', '5511999990001', '22522791508', '${DRV}');
    insert into public.veiculos (id, filial_id, placa, km_atual, motorista_id) values
      ('${V_1}', '${F_SP}', 'ABC1D23', 1000, '${M_1}'), ('${V_2}', '${F_SP}', 'DEF4G56', 2000, null);
  `);
});

describe('avaria crítica no checklist', () => {
  it('checklist sem avaria crítica não abre manutenção nem bloqueia', async () => {
    await as(SUP_SP, () => salvar(ck(1), V_1, 1100, {}));
    expect(await abertas(V_1)).toHaveLength(0);
    expect(await bloqueios(V_1)).toHaveLength(0);
  });

  it('abre a manutenção corretiva com os itens e descrições e deixa o veículo não liberado', async () => {
    await as(DRV, () => salvar(ck(2), V_1, 1200, { pneu_dianteiro_esquerdo: 'pneu rasgado' }, 'óleo pingando no motor'));
    const [m] = await abertas(V_1);
    expect(m).toMatchObject({ tipo: 'corretiva', custo: '0.00', checklist_id: ck(2), created_by: DRV });
    expect(m!.descricao).toMatch(/^Avaria no checklist diário de \d{2}\/\d{2}\/\d{4}: Pneu dianteiro esquerdo: pneu rasgado; Vazamento ou avaria: óleo pingando no motor$/);
    expect(await bloqueios(V_1)).toEqual([{ liberado_em: null, liberacao: null, liberacao_obs: null, liberado_por: null }]);
    const p = await painel(V_1);
    expect(p.bloqueio_id).not.toBeNull();
    expect(p.manutencoes_abertas).toBe(1);
    expect(p.ultima_corretiva_em).toBeNull(); // conserto pendente não conta como feito
  });

  it('nova avaria com o conserto ainda pendente acrescenta na mesma manutenção (sem duplicar)', async () => {
    await as(SUP_SP, () => salvar(ck(3), V_1, 1250, { bancos: 'banco do motorista solto' }));
    const lista = await abertas(V_1);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.descricao.split('\n')).toHaveLength(2);
    expect(lista[0]!.descricao).toContain('Bancos: banco do motorista solto');
    expect(await bloqueios(V_1)).toHaveLength(1);
  });

  it('o motorista vê o bloqueio do próprio veículo, mas não a manutenção (custos)', async () => {
    await as(DRV, async () => {
      expect(await rows('select 1 from public.veiculo_bloqueios')).toHaveLength(1);
      expect(await rows('select 1 from public.manutencoes')).toHaveLength(0);
      expect((await painel(V_1)).bloqueio_id).not.toBeNull();
    });
    await as(SUP_RJ, async () => expect(await rows('select 1 from public.veiculo_bloqueios')).toHaveLength(0));
  });

  it('ninguém grava bloqueio direto na tabela', async () => {
    await as(SUP_SP, async () => {
      await expect(
        db.query(`insert into public.veiculo_bloqueios (veiculo_id, filial_id, motivo) values ($1, $2, 'teste')`, [V_2, F_SP]),
      ).rejects.toThrow(/row-level security/);
      expect((await db.query(`update public.veiculo_bloqueios set liberado_em = now(), liberacao = 'responsavel'`)).affectedRows).toBe(0);
    });
  });
});

describe('liberação do veículo', () => {
  const liberar = (veiculo: string, motivo: string | null) => db.query('select public.liberar_veiculo($1, $2)', [veiculo, motivo]);

  it('só o supervisor da filial ou o admin liberam, e com motivo', async () => {
    await as(DRV, async () => expect(liberar(V_1, 'quero rodar')).rejects.toThrow(/Somente o supervisor/));
    await as(SUP_RJ, async () => expect(liberar(V_1, 'outra filial')).rejects.toThrow(/Somente o supervisor/));
    await as(SUP_SP, async () => expect(liberar(V_1, '  ')).rejects.toThrow(/motivo da liberação/));
  });

  it('pelo responsável: libera o veículo e a manutenção continua pendente', async () => {
    await as(SUP_SP, () => liberar(V_1, 'Pneu trocado pelo estepe; seguir até a oficina'));
    const [b] = await bloqueios(V_1);
    expect(b).toMatchObject({ liberacao: 'responsavel', liberacao_obs: 'Pneu trocado pelo estepe; seguir até a oficina', liberado_por: SUP_SP });
    const p = await painel(V_1);
    expect(p.bloqueio_id).toBeNull();
    expect(p.manutencoes_abertas).toBe(1);
    expect(p.ultima_liberacao_em).not.toBeNull();
    await as(SUP_SP, async () => expect(liberar(V_1, 'de novo, já liberado')).rejects.toThrow(/já está liberado/));
  });

  it('nova avaria depois da liberação bloqueia de novo (na mesma manutenção pendente)', async () => {
    await as(DRV, () => salvar(ck(4), V_1, 1300, { retrovisor_direito: 'espelho quebrado' }));
    expect(await abertas(V_1)).toHaveLength(1);
    const lista = await bloqueios(V_1);
    expect(lista).toHaveLength(2);
    expect(lista[1]!.liberado_em).toBeNull();
  });

  it('por conserto: concluir a manutenção libera o veículo; não dá para reabrir', async () => {
    const [m] = await abertas(V_1);
    await as(SUP_SP, async () => {
      const r = await db.query(
        `update public.manutencoes set situacao = 'concluida', custo = 850, fornecedor = 'Oficina Central' where id = $1`,
        [m!.id],
      );
      expect(r.affectedRows).toBe(1);
    });
    const lista = await bloqueios(V_1);
    expect(lista[1]).toMatchObject({ liberacao: 'conserto', liberado_por: SUP_SP });
    expect(await rows('select concluida_por, (concluida_em is not null) as tem_data from public.manutencoes where id = $1', [m!.id])).toEqual([
      { concluida_por: SUP_SP, tem_data: true },
    ]);
    const p = await painel(V_1);
    expect(p).toMatchObject({ bloqueio_id: null, manutencoes_abertas: 0 });
    expect(p.ultima_corretiva_em).not.toBeNull();
    await as(SUP_SP, async () =>
      expect(db.query(`update public.manutencoes set situacao = 'aberta' where id = $1`, [m!.id])).rejects.toThrow(/não pode ser reaberta/),
    );
  });

  it('o motorista não conclui manutenção', async () => {
    await as(SUP_SP, () => salvar(ck(5), V_2, 2100, { frente: 'farol quebrado' }).catch(() => null));
    // V_2 não tem motorista responsável: o checklist do supervisor usa M_1 (mesma filial)
    const [m] = await abertas(V_2);
    await as(DRV, async () => {
      expect((await db.query(`update public.manutencoes set situacao = 'concluida' where id = $1`, [m!.id])).affectedRows).toBe(0);
    });
    expect((await painel(V_2)).bloqueio_id).not.toBeNull();
  });
});
