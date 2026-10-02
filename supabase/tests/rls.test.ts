/**
 * Testes de isolamento multi-filial (RBAC + RLS).
 *
 * Roda a migration real em um Postgres embutido (PGlite) com um shim mínimo da
 * plataforma Supabase e valida, por role, o que cada usuário consegue ver/alterar.
 *   npm test
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarBanco } from './banco';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const SUP_SP = '00000000-0000-4000-8000-0000000000b1';
const SUP_RJ = '00000000-0000-4000-8000-0000000000b2';
const SUP_SP2 = '00000000-0000-4000-8000-0000000000b3';
const F_SP = '10000000-0000-4000-8000-000000000001';
const F_RJ = '10000000-0000-4000-8000-000000000002';
const V_SP = '20000000-0000-4000-8000-000000000001';
const V_RJ = '20000000-0000-4000-8000-000000000002';
const M_SP = '30000000-0000-4000-8000-000000000001';
const M_RJ = '30000000-0000-4000-8000-000000000002';

const CATEGORIAS = [
  'lateral_direita', 'lateral_esquerda', 'frente', 'traseira', 'carroceria_portamalas',
  'interior', 'painel', 'rodas', 'nivel_oleo', 'nivel_agua', 'motor', 'retrovisores',
  'para_brisa', 'luzes_sinalizacao',
] as const;

type FotoPayload = {
  categoria_foto: string;
  foto_url: string;
  severidade: string;
  observacao: string | null;
  marcadores: unknown[];
};

const fotos = (filial: string, checklistId: string, severidades: Record<string, string> = {}): FotoPayload[] =>
  CATEGORIAS.map((categoria) => ({
    categoria_foto: categoria,
    foto_url: `${filial}/${checklistId}/${categoria}.jpg`,
    severidade: severidades[categoria] ?? 'ok',
    observacao: severidades[categoria] ? 'detalhe' : null,
    marcadores: [],
  }));

let db: PGlite;
let as: Awaited<ReturnType<typeof criarBanco>>['as'];
let rows: Awaited<ReturnType<typeof criarBanco>>['rows'];

beforeAll(async () => {
  ({ db, as, rows } = await criarBanco());

  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@x.com'), ('${SUP_SP}', 'sp@x.com'), ('${SUP_RJ}', 'rj@x.com'), ('${SUP_SP2}', 'sp2@x.com');
    insert into public.filiais (id, nome_cidade, uf) values
      ('${F_SP}', 'São Paulo', 'SP'), ('${F_RJ}', 'Rio de Janeiro', 'RJ');
    insert into public.profiles (id, nome, role, filial_id) values
      ('${ADMIN}', 'Admin Geral', 'admin', null),
      ('${SUP_SP}', 'Sup SP', 'supervisor', '${F_SP}'),
      ('${SUP_RJ}', 'Sup RJ', 'supervisor', '${F_RJ}'),
      ('${SUP_SP2}', 'Sup SP 2', 'supervisor', '${F_SP}');
    insert into public.veiculos (id, filial_id, placa, km_atual) values
      ('${V_SP}', '${F_SP}', 'ABC1D23', 1000), ('${V_RJ}', '${F_RJ}', 'XYZ9K88', 5000);
    insert into public.motoristas (id, filial_id, nome, cpf, email, whatsapp, cnh) values
      ('${M_SP}', '${F_SP}', 'Motorista SP', '52998224725', 'sp@m.com', '5511999990001', '22522791508'),
      ('${M_RJ}', '${F_RJ}', 'Motorista RJ', '11144477735', 'rj@m.com', '5521999990002', '22522791508');
  `);
});

describe('anon', () => {
  it('não acessa nenhuma tabela de negócio', async () => {
    await expect(as(null, () => rows('select * from public.veiculos'))).rejects.toThrow(/permission denied/);
    await expect(as(null, () => rows('select * from public.vw_veiculos_painel'))).rejects.toThrow(/permission denied/);
  });
});

describe('admin: visão global', () => {
  it('enxerga todas as filiais, veículos e motoristas', async () => {
    await as(ADMIN, async () => {
      expect(await rows('select id from public.filiais')).toHaveLength(2);
      expect(await rows('select id from public.veiculos')).toHaveLength(2);
      expect(await rows('select id from public.motoristas')).toHaveLength(2);
      expect(await rows('select id from public.vw_veiculos_painel')).toHaveLength(2);
      expect(await rows('select id from public.profiles')).toHaveLength(4);
    });
  });

  it('cria filial e exclui veículo sem histórico', async () => {
    await as(ADMIN, async () => {
      await db.query(`insert into public.filiais (nome_cidade, uf) values ('Curitiba', 'PR')`);
      await db.query(
        `insert into public.veiculos (id, filial_id, placa) values ('20000000-0000-4000-8000-0000000000ff', $1, 'DEL1A11')`,
        [F_SP],
      );
      const del = await db.query(`delete from public.veiculos where placa = 'DEL1A11'`);
      expect(del.affectedRows).toBe(1);
    });
  });
});

describe('supervisor: isolamento por filial', () => {
  it('enxerga somente a própria filial', async () => {
    await as(SUP_SP, async () => {
      expect(await rows('select id from public.filiais')).toEqual([{ id: F_SP }]);
      expect(await rows('select id from public.veiculos')).toEqual([{ id: V_SP }]);
      expect(await rows('select id from public.motoristas')).toEqual([{ id: M_SP }]);
      expect(await rows('select id from public.vw_veiculos_painel')).toEqual([{ id: V_SP }]);
      // perfis: o próprio + colegas da MESMA filial; nunca os de outra filial nem o admin
      const perfis = (await rows<{ id: string }>('select id from public.profiles order by id')).map((p) => p.id);
      expect(perfis).toEqual([SUP_SP, SUP_SP2]);
    });
  });

  it('não altera nem exclui dados de outra filial (0 linhas afetadas)', async () => {
    await as(SUP_SP, async () => {
      const upd = await db.query(`update public.veiculos set km_atual = 1 where id = $1`, [V_RJ]);
      expect(upd.affectedRows).toBe(0);
      const del = await db.query(`delete from public.veiculos where id = $1`, [V_RJ]);
      expect(del.affectedRows).toBe(0);
      const updM = await db.query(`update public.motoristas set status = 'inativo' where id = $1`, [M_RJ]);
      expect(updM.affectedRows).toBe(0);
    });
    expect(await rows('select km_atual from public.veiculos where id = $1', [V_RJ])).toEqual([{ km_atual: 5000 }]);
  });

  it('não insere dados em outra filial', async () => {
    await as(SUP_SP, async () => {
      await expect(
        db.query(`insert into public.veiculos (filial_id, placa) values ($1, 'NEW1A11')`, [F_RJ]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.query(`insert into public.motoristas (filial_id, nome, cpf, email, whatsapp, cnh)
                  values ($1, 'Fulano', '39053344705', 'f@x.com', '5511999990003', '22522791508')`, [F_RJ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('não move um veículo da própria filial para outra (WITH CHECK)', async () => {
    await as(SUP_SP, async () => {
      await expect(
        db.query(`update public.veiculos set filial_id = $1 where id = $2`, [F_RJ, V_SP]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('não exclui registros nem da própria filial (somente admin exclui)', async () => {
    await as(SUP_SP, async () => {
      expect((await db.query(`delete from public.veiculos where id = $1`, [V_SP])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.filiais where id = $1`, [F_SP])).affectedRows).toBe(0);
    });
  });

  it('não escala o próprio privilégio nem troca de filial', async () => {
    await as(SUP_SP, async () => {
      expect((await db.query(`update public.profiles set role = 'admin', filial_id = null where id = $1`, [SUP_SP])).affectedRows).toBe(0);
      expect((await db.query(`update public.profiles set filial_id = $1 where id = $2`, [F_RJ, SUP_SP])).affectedRows).toBe(0);
      // nem altera o perfil de um colega que consegue enxergar
      expect((await db.query(`update public.profiles set nome = 'x' where id = $1`, [SUP_SP2])).affectedRows).toBe(0);
      await expect(
        db.query(`insert into public.profiles (id, nome, role) values ($1, 'Hack', 'admin')`, [SUP_RJ]),
      ).rejects.toThrow();
    });
  });

  it('FK composta impede referenciar veículo/motorista de outra filial', async () => {
    // mesmo com filial_id = própria filial, o par (veiculo_id, filial_id) precisa existir
    await as(SUP_SP, async () => {
      await expect(
        db.query(
          `insert into public.checklists (veiculo_id, motorista_id, filial_id) values ($1, $2, $3)`,
          [V_RJ, M_SP, F_SP],
        ),
      ).rejects.toThrow(/foreign key/);
      await expect(
        db.query(
          `insert into public.manutencoes (veiculo_id, filial_id, tipo, descricao, km_registro)
           values ($1, $2, 'preventiva', 'troca de óleo', 10)`,
          [V_RJ, F_SP],
        ),
      ).rejects.toThrow(/foreign key/);
    });
  });
});

describe('salvar_checklist (RPC atômica)', () => {
  const CK = '40000000-0000-4000-8000-000000000001';

  it('rejeita veículo de outra filial', async () => {
    await as(SUP_SP, async () => {
      await expect(
        db.query(`select public.salvar_checklist($1, $2, $3, null, 100, $4::jsonb)`,
          [CK, V_RJ, M_SP, JSON.stringify(fotos(F_RJ, CK))]),
      ).rejects.toThrow(/sem permissão/);
    });
  });

  it('rejeita checklist com menos de 14 fotos e não deixa lixo no banco', async () => {
    await as(SUP_SP, async () => {
      await expect(
        db.query(`select public.salvar_checklist($1, $2, $3, null, 100, $4::jsonb)`,
          [CK, V_SP, M_SP, JSON.stringify(fotos(F_SP, CK).slice(0, 13))]),
      ).rejects.toThrow(/14 fotos/);
    });
    expect(await rows('select id from public.checklists')).toHaveLength(0);
  });

  it('rejeita categorias repetidas', async () => {
    const dup = fotos(F_SP, CK);
    dup[13] = { ...dup[0]! };
    await as(SUP_SP, async () => {
      await expect(
        db.query(`select public.salvar_checklist($1, $2, $3, null, 100, $4::jsonb)`,
          [CK, V_SP, M_SP, JSON.stringify(dup)]),
      ).rejects.toThrow(/14 fotos/);
    });
  });

  it('salva checklist + 14 fotos, deriva o status pela pior severidade e atualiza o KM', async () => {
    await as(SUP_SP, async () => {
      await db.query(
        `select public.salvar_checklist($1, $2, $3, '  Tudo certo  ', 1500, $4::jsonb)`,
        [CK, V_SP, M_SP, JSON.stringify(fotos(F_SP, CK, { rodas: 'atencao', motor: 'critico' }))],
      );
      const [ck] = await rows<{ status: string; observacoes_gerais: string; supervisor_id: string; filial_id: string }>(
        'select status, observacoes_gerais, supervisor_id, filial_id from public.checklists where id = $1', [CK]);
      expect(ck).toEqual({ status: 'critico', observacoes_gerais: 'Tudo certo', supervisor_id: SUP_SP, filial_id: F_SP });
      expect(await rows('select 1 from public.checklist_fotos where checklist_id = $1', [CK])).toHaveLength(14);
      const [v] = await rows<{ km_atual: number }>('select km_atual from public.veiculos where id = $1', [V_SP]);
      expect(v?.km_atual).toBe(1500);

      const [painel] = await rows<{ ultimo_checklist_status: string }>(
        'select ultimo_checklist_status from public.vw_veiculos_painel where id = $1', [V_SP]);
      expect(painel?.ultimo_checklist_status).toBe('critico');
    });
  });

  it('o KM nunca regride', async () => {
    const CK2 = '40000000-0000-4000-8000-000000000002';
    await as(SUP_SP, async () => {
      await db.query(`select public.salvar_checklist($1, $2, $3, null, 900, $4::jsonb)`,
        [CK2, V_SP, M_SP, JSON.stringify(fotos(F_SP, CK2))]);
      const [v] = await rows<{ km_atual: number }>('select km_atual from public.veiculos where id = $1', [V_SP]);
      expect(v?.km_atual).toBe(1500);
    });
  });

  it('o supervisor da outra filial não vê o checklist nem as fotos', async () => {
    await as(SUP_RJ, async () => {
      expect(await rows('select id from public.checklists')).toHaveLength(0);
      expect(await rows('select id from public.checklist_fotos')).toHaveLength(0);
    });
    await as(ADMIN, async () => {
      expect((await rows('select id from public.checklists')).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('checklists são imutáveis para supervisores (somente admin corrige)', async () => {
    await as(SUP_SP, async () => {
      expect((await db.query(`update public.checklists set status = 'ok' where id = $1`, [CK])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.checklist_fotos where checklist_id = $1`, [CK])).affectedRows).toBe(0);
    });
  });
});

describe('rascunhos do checklist', () => {
  it('cada usuário lê/grava somente o próprio rascunho (nem o admin lê o dos outros)', async () => {
    await as(SUP_SP, async () => {
      await db.query(`insert into public.checklist_rascunhos (dados) values ('{"passo": 3}'::jsonb)`); // user_id = auth.uid()
      // upsert (mesmo usuário) atualiza em vez de duplicar
      await db.query(
        `insert into public.checklist_rascunhos (user_id, dados) values ($1, '{"passo": 5}'::jsonb)
         on conflict (user_id) do update set dados = excluded.dados`,
        [SUP_SP],
      );
      expect(await rows('select dados from public.checklist_rascunhos')).toEqual([{ dados: { passo: 5 } }]);
      // não grava em nome de outro usuário
      await expect(
        db.query(`insert into public.checklist_rascunhos (user_id, dados) values ($1, '{}'::jsonb)`, [SUP_SP2]),
      ).rejects.toThrow(/row-level security/);
    });
    await as(SUP_SP2, async () => {
      expect(await rows('select 1 from public.checklist_rascunhos')).toHaveLength(0);
      expect((await db.query(`delete from public.checklist_rascunhos`)).affectedRows).toBe(0);
    });
    await as(ADMIN, async () => {
      expect(await rows('select 1 from public.checklist_rascunhos')).toHaveLength(0);
    });
    await as(null, async () => {
      await expect(rows('select 1 from public.checklist_rascunhos')).rejects.toThrow(/permission denied/);
    });
  });
});

describe('Storage', () => {
  it('supervisor só escreve/lê na pasta da própria filial', async () => {
    await as(SUP_SP, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('checklists', $1)`, [`${F_SP}/ck/frente.jpg`]);
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('checklists', $1)`, [`${F_RJ}/ck/frente.jpg`]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('veiculos', $1)`, [`${F_RJ}/doc.pdf`]),
      ).rejects.toThrow(/row-level security/);
    });
    await as(ADMIN, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('checklists', $1)`, [`${F_RJ}/ck/frente.jpg`]);
    });
    await as(SUP_SP, async () => {
      const names = (await rows<{ name: string }>('select name from storage.objects')).map((r) => r.name);
      expect(names).toEqual([`${F_SP}/ck/frente.jpg`]);
    });
    await as(SUP_RJ, async () => {
      const names = (await rows<{ name: string }>('select name from storage.objects')).map((r) => r.name);
      expect(names).toEqual([`${F_RJ}/ck/frente.jpg`]);
    });
  });
});
