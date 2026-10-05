/**
 * Acesso do motorista (papel "motorista"), CNH, abastecimentos e "Meu perfil".
 * Mesmo esquema de rls.test.ts: migrations reais no PGlite, testes por usuário.
 *   npm test
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarBanco } from './banco';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const SUP_SP = '00000000-0000-4000-8000-0000000000b1';
const SUP_RJ = '00000000-0000-4000-8000-0000000000b2';
const DRV_1 = '00000000-0000-4000-8000-0000000000c1'; // login do motorista M_1
const DRV_2 = '00000000-0000-4000-8000-0000000000c2'; // login do motorista M_2
const F_SP = '10000000-0000-4000-8000-000000000001';
const F_RJ = '10000000-0000-4000-8000-000000000002';
const V_1 = '20000000-0000-4000-8000-000000000001'; // SP, responsável M_1
const V_2 = '20000000-0000-4000-8000-000000000002'; // SP, sem responsável
const V_RJ = '20000000-0000-4000-8000-000000000003';
const M_1 = '30000000-0000-4000-8000-000000000001';
const M_2 = '30000000-0000-4000-8000-000000000002';
const M_3 = '30000000-0000-4000-8000-000000000003'; // sem login
const M_RJ = '30000000-0000-4000-8000-000000000004';

let db: PGlite;
let as: Awaited<ReturnType<typeof criarBanco>>['as'];
let rows: Awaited<ReturnType<typeof criarBanco>>['rows'];

const ids = async (sql: string) => (await rows<{ id: string }>(sql)).map((r) => r.id).sort();

const abastecer = (motoristaId: string | null, veiculoId: string, km: number, filialId = F_SP) =>
  db.query(
    `insert into public.abastecimentos (veiculo_id, filial_id, motorista_id, km, litros, valor_total, combustivel)
     values ($1, $2, $3, $4, 40, 239.60, 'diesel_s10') returning id, registrado_por, preco_litro`,
    [veiculoId, filialId, motoristaId, km],
  );

beforeAll(async () => {
  ({ db, as, rows } = await criarBanco());
  // o vínculo de login é feito como o servidor faria (fora do role authenticated)
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@x.com'), ('${SUP_SP}', 'sp@x.com'), ('${SUP_RJ}', 'rj@x.com'),
      ('${DRV_1}', 'diogo@x.com'), ('${DRV_2}', 'ana@x.com');
    insert into public.filiais (id, nome_cidade, uf) values
      ('${F_SP}', 'São Paulo', 'SP'), ('${F_RJ}', 'Rio de Janeiro', 'RJ');
    insert into public.profiles (id, nome, role, filial_id) values
      ('${ADMIN}', 'Admin Geral', 'admin', null),
      ('${SUP_SP}', 'Sup SP', 'supervisor', '${F_SP}'),
      ('${SUP_RJ}', 'Sup RJ', 'supervisor', '${F_RJ}'),
      ('${DRV_1}', 'Diogo', 'motorista', '${F_SP}'),
      ('${DRV_2}', 'Ana', 'motorista', '${F_SP}');
    insert into public.motoristas (id, filial_id, nome, cpf, email, whatsapp, cnh, user_id, cnh_frente_url) values
      ('${M_1}', '${F_SP}', 'Diogo', '52998224725', 'diogo@x.com', '5511999990001', '22522791508', '${DRV_1}', '${F_SP}/m1/cnh-frente.jpg'),
      ('${M_2}', '${F_SP}', 'Ana',   '39053344705', 'ana@x.com',   '5511999990002', '22522791508', '${DRV_2}', '${F_SP}/m2/cnh-frente.jpg'),
      ('${M_3}', '${F_SP}', 'Bruno', '11144477735', 'bruno@x.com', '5511999990003', '22522791508', null, null),
      ('${M_RJ}', '${F_RJ}', 'Carla', '52998224725', 'carla@x.com', '5521999990004', '22522791508', null, null);
    insert into public.veiculos (id, filial_id, placa, km_atual, motorista_id, documento_url) values
      ('${V_1}', '${F_SP}', 'ABC1D23', 1000, '${M_1}', '${F_SP}/veiculos/v1/documento.pdf'),
      ('${V_2}', '${F_SP}', 'DEF4G56', 2000, null, '${F_SP}/veiculos/v2/documento.pdf'),
      ('${V_RJ}', '${F_RJ}', 'XYZ9K88', 5000, '${M_RJ}', null);
    insert into public.manutencoes (veiculo_id, filial_id, tipo, custo, descricao, km_registro)
      values ('${V_1}', '${F_SP}', 'preventiva', 850, 'troca de óleo', 900);
  `);
});

describe('motorista: enxerga só o que é dele', () => {
  it('lê somente o próprio cadastro, o próprio veículo e a própria filial', async () => {
    await as(DRV_1, async () => {
      expect(await ids('select id from public.veiculos')).toEqual([V_1]);
      expect(await ids('select id from public.motoristas')).toEqual([M_1]);
      expect(await ids('select id from public.filiais')).toEqual([F_SP]);
      expect(await ids('select id from public.profiles')).toEqual([DRV_1]);
      const painel = await rows('select id, motorista_nome from public.vw_veiculos_painel');
      expect(painel).toEqual([{ id: V_1, motorista_nome: 'Diogo' }]);
    });
  });

  it('não lê manutenções (custos), checklists nem dados de outra filial', async () => {
    await as(DRV_1, async () => {
      expect(await rows('select 1 from public.manutencoes')).toHaveLength(0);
      expect(await rows('select 1 from public.checklists')).toHaveLength(0);
      expect(await rows('select 1 from public.vw_veiculos_painel where ultima_preventiva_id is not null')).toHaveLength(0);
    });
  });

  it('motorista sem veículo vinculado não vê veículo nenhum', async () => {
    await as(DRV_2, async () => {
      expect(await rows('select 1 from public.veiculos')).toHaveLength(0);
      expect(await ids('select id from public.motoristas')).toEqual([M_2]);
    });
  });

  it('não altera veículos, cadastros nem perfis (nem os próprios)', async () => {
    await as(DRV_1, async () => {
      expect((await db.query(`update public.veiculos set km_atual = 1 where id = $1`, [V_1])).affectedRows).toBe(0);
      expect((await db.query(`update public.motoristas set cnh_validade = '2099-01-01' where id = $1`, [M_1])).affectedRows).toBe(0);
      expect((await db.query(`update public.profiles set role = 'admin', filial_id = null where id = $1`, [DRV_1])).affectedRows).toBe(0);
      await expect(db.query(`insert into public.veiculos (filial_id, placa) values ($1, 'NEW1A11')`, [F_SP])).rejects.toThrow(
        /row-level security/,
      );
      await expect(
        db.query(`insert into public.manutencoes (veiculo_id, filial_id, tipo, descricao, km_registro)
                  values ($1, $2, 'corretiva', 'xxxx', 10)`, [V_1, F_SP]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('não registra checklist de veículo que não é dele nem em nome de outro motorista', async () => {
    await as(DRV_1, async () => {
      await expect(
        db.query(`insert into public.checklists (veiculo_id, motorista_id, filial_id) values ($1, $2, $3)`, [V_2, M_1, F_SP]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.query(`insert into public.checklists (veiculo_id, motorista_id, filial_id) values ($1, $2, $3)`, [V_1, M_2, F_SP]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('motorista inativo perde o acesso na hora', async () => {
    await db.query(`update public.motoristas set status = 'inativo' where id = $1`, [M_1]);
    await as(DRV_1, async () => {
      expect(await rows('select 1 from public.veiculos')).toHaveLength(0);
      expect(await rows('select 1 from public.motoristas')).toHaveLength(0);
    });
    await db.query(`update public.motoristas set status = 'ativo' where id = $1`, [M_1]);
  });
});

describe('abastecimentos', () => {
  it('o motorista lança no próprio veículo; o KM do veículo é atualizado', async () => {
    await as(DRV_1, async () => {
      const { rows: [novo] } = await abastecer(M_1, V_1, 1450);
      expect(novo).toMatchObject({ registrado_por: DRV_1, preco_litro: '5.990' });
      expect(await rows('select km_atual from public.veiculos where id = $1', [V_1])).toEqual([{ km_atual: 1450 }]);
    });
  });

  it('o KM do veículo nunca regride', async () => {
    await as(DRV_1, async () => {
      await abastecer(M_1, V_1, 1200);
      expect(await rows('select km_atual from public.veiculos where id = $1', [V_1])).toEqual([{ km_atual: 1450 }]);
    });
  });

  it('não lança em veículo que não é dele nem em nome de outro motorista', async () => {
    await as(DRV_1, async () => {
      await expect(abastecer(M_1, V_2, 2100)).rejects.toThrow(/row-level security|foreign key/);
      await expect(abastecer(M_2, V_1, 1500)).rejects.toThrow(/row-level security/);
      await expect(abastecer(null, V_1, 1500)).rejects.toThrow(/row-level security/);
      await expect(abastecer(M_1, V_RJ, 6000, F_RJ)).rejects.toThrow(/row-level security|foreign key/);
    });
    await as(DRV_2, async () => {
      await expect(abastecer(M_2, V_2, 2100)).rejects.toThrow(/row-level security/);
    });
  });

  it('o lançamento é imutável para o motorista e para o supervisor', async () => {
    await as(DRV_1, async () => {
      expect((await db.query(`update public.abastecimentos set litros = 1`)).affectedRows).toBe(0);
      expect((await db.query(`delete from public.abastecimentos`)).affectedRows).toBe(0);
    });
    await as(SUP_SP, async () => {
      expect((await db.query(`update public.abastecimentos set litros = 1`)).affectedRows).toBe(0);
      expect((await db.query(`delete from public.abastecimentos`)).affectedRows).toBe(0);
    });
  });

  it('cada motorista vê só os próprios; supervisor vê a filial; outra filial não vê', async () => {
    await as(DRV_2, async () => {
      expect(await rows('select 1 from public.abastecimentos')).toHaveLength(0);
    });
    await as(SUP_SP, async () => {
      expect(await rows('select 1 from public.abastecimentos')).toHaveLength(2);
      // supervisor também pode lançar (ex.: motorista sem celular)
      await abastecer(M_3, V_2, 2300);
    });
    await as(SUP_RJ, async () => {
      expect(await rows('select 1 from public.abastecimentos')).toHaveLength(0);
      await expect(abastecer(null, V_1, 1600)).rejects.toThrow(/row-level security/);
    });
    await as(ADMIN, async () => {
      expect(await rows('select 1 from public.abastecimentos')).toHaveLength(3);
    });
  });
});

describe('vínculo de login e cadastro', () => {
  it('nem supervisor nem admin (pelo app) trocam o login vinculado ao motorista', async () => {
    await as(SUP_SP, async () => {
      await expect(db.query(`update public.motoristas set user_id = $1 where id = $2`, [SUP_SP, M_3])).rejects.toThrow(
        /gerenciado pelo sistema/,
      );
      await expect(
        db.query(`insert into public.motoristas (filial_id, nome, cpf, email, whatsapp, cnh, user_id)
                  values ($1, 'Novo', '86288366757', 'n@x.com', '5511999990009', '22522791508', $2)`, [F_SP, DRV_2]),
      ).rejects.toThrow(/gerenciado pelo sistema/);
      // editar os demais campos continua livre
      expect((await db.query(`update public.motoristas set cnh_categoria = 'D', cnh_validade = '2030-05-01' where id = $1`, [M_1])).affectedRows).toBe(1);
    });
    await as(ADMIN, async () => {
      await expect(db.query(`update public.motoristas set user_id = null where id = $1`, [M_1])).rejects.toThrow(
        /gerenciado pelo sistema/,
      );
    });
  });

  it('o nome do motorista no login acompanha o cadastro', async () => {
    await as(SUP_SP, async () => {
      await db.query(`update public.motoristas set nome = 'Diogo Soares' where id = $1`, [M_1]);
    });
    expect(await rows('select nome from public.profiles where id = $1', [DRV_1])).toEqual([{ nome: 'Diogo Soares' }]);
  });

  it('o responsável pelo veículo precisa ser da mesma filial', async () => {
    await as(ADMIN, async () => {
      await expect(db.query(`update public.veiculos set motorista_id = $1 where id = $2`, [M_1, V_RJ])).rejects.toThrow(
        /foreign key/,
      );
    });
  });

  it('valida categoria e datas da CNH', async () => {
    await as(SUP_SP, async () => {
      await expect(db.query(`update public.motoristas set cnh_categoria = 'Z' where id = $1`, [M_1])).rejects.toThrow(/check/);
      await expect(
        db.query(`update public.motoristas set cnh_emissao = '2025-01-01', cnh_validade = '2024-01-01' where id = $1`, [M_1]),
      ).rejects.toThrow(/check/);
    });
  });
});

describe('Meu perfil (atualizar_meu_perfil)', () => {
  it('admin e supervisor trocam o próprio nome e foto', async () => {
    await as(ADMIN, async () => {
      await db.query(`select public.atualizar_meu_perfil('Ezequias Lucas', $1)`, [`${ADMIN}/avatar-1.jpg`]);
      expect(await rows('select nome, avatar_url, role from public.profiles where id = $1', [ADMIN])).toEqual([
        { nome: 'Ezequias Lucas', avatar_url: `${ADMIN}/avatar-1.jpg`, role: 'admin' },
      ]);
    });
  });

  it('o motorista troca só a foto (o nome vem do cadastro)', async () => {
    await as(DRV_1, async () => {
      await db.query(`select public.atualizar_meu_perfil('Outro Nome', $1)`, [`${DRV_1}/avatar-2.jpg`]);
      expect(await rows('select nome, avatar_url from public.profiles where id = $1', [DRV_1])).toEqual([
        { nome: 'Diogo Soares', avatar_url: `${DRV_1}/avatar-2.jpg` },
      ]);
    });
  });

  it('recusa foto fora da própria pasta', async () => {
    await as(SUP_SP, async () => {
      await expect(db.query(`select public.atualizar_meu_perfil('Sup', $1)`, [`${ADMIN}/avatar-1.jpg`])).rejects.toThrow(
        /inválida/,
      );
    });
  });
});

describe('Storage do motorista', () => {
  const inserir = (bucket: string, name: string) =>
    db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);
  const nomes = async () => (await rows<{ name: string }>('select name from storage.objects order by name')).map((r) => r.name);

  beforeAll(async () => {
    // arquivos já existentes (enviados por supervisores)
    await db.exec(`
      insert into storage.objects (bucket_id, name) values
        ('motoristas', '${F_SP}/m1/cnh-frente.jpg'),
        ('motoristas', '${F_SP}/m2/cnh-frente.jpg'),
        ('veiculos',   '${F_SP}/veiculos/v1/documento.pdf'),
        ('veiculos',   '${F_SP}/veiculos/v2/documento.pdf'),
        ('perfis',     '${ADMIN}/avatar-1.jpg');
    `);
  });

  it('envia comprovante só na pasta dos próprios veículos', async () => {
    await as(DRV_1, async () => {
      await inserir('abastecimentos', `${F_SP}/${V_1}/cupom-1.jpg`);
      await expect(inserir('abastecimentos', `${F_SP}/${V_2}/cupom.jpg`)).rejects.toThrow(/row-level security/);
      await expect(inserir('abastecimentos', `${F_RJ}/${V_1}/cupom.jpg`)).rejects.toThrow(/row-level security/);
      await expect(inserir('veiculos', `${F_SP}/veiculos/v1/foto-geral.jpg`)).rejects.toThrow(/row-level security/);
      await expect(inserir('motoristas', `${F_SP}/m1/cnh-verso.jpg`)).rejects.toThrow(/row-level security/);
    });
  });

  it('abre só a própria CNH, o documento do próprio veículo e os próprios comprovantes', async () => {
    await as(DRV_1, async () => {
      expect(await nomes()).toEqual([
        `${F_SP}/${V_1}/cupom-1.jpg`,
        `${F_SP}/m1/cnh-frente.jpg`,
        `${F_SP}/veiculos/v1/documento.pdf`,
      ]);
    });
    await as(DRV_2, async () => {
      expect(await nomes()).toEqual([`${F_SP}/m2/cnh-frente.jpg`]);
    });
  });

  it('supervisor lê CNH e comprovantes da filial; a outra filial não', async () => {
    await as(SUP_SP, async () => {
      expect(await nomes()).toEqual(expect.arrayContaining([`${F_SP}/${V_1}/cupom-1.jpg`, `${F_SP}/m2/cnh-frente.jpg`]));
    });
    await as(SUP_RJ, async () => {
      expect(await nomes()).toEqual([]);
    });
  });

  it('foto de perfil: cada um na própria pasta', async () => {
    await as(SUP_SP, async () => {
      await inserir('perfis', `${SUP_SP}/avatar-1.jpg`);
      await expect(inserir('perfis', `${ADMIN}/avatar-9.jpg`)).rejects.toThrow(/row-level security/);
      expect((await nomes()).filter((n) => n.includes(ADMIN))).toEqual([]);
    });
  });
});

// Modelo padrão do checklist DIÁRIO (migration 20260105): 15 fotos + a pergunta de vazamento/avaria
const DIARIO = [
  'frente', 'traseira', 'lateral_esquerda', 'lateral_direita',
  'pneu_dianteiro_esquerdo', 'pneu_dianteiro_direito', 'pneu_traseiro_esquerdo', 'pneu_traseiro_direito',
  'retrovisor_esquerdo', 'retrovisor_direito', 'nivel_oleo', 'fluido_freio', 'nivel_agua', 'painel', 'bancos',
];
const CK_1 = '40000000-0000-4000-8000-0000000000d1'; // feito pelo motorista M_1
const CK_SUP_M1 = '40000000-0000-4000-8000-0000000000d2'; // feito pelo supervisor, motorista M_1
const CK_SUP_M3 = '40000000-0000-4000-8000-0000000000d3'; // feito pelo supervisor, motorista M_3
const CK_RASCUNHO_1 = '40000000-0000-4000-8000-0000000000e1'; // ainda não enviado (fotos do M_1)
const CK_RASCUNHO_2 = '40000000-0000-4000-8000-0000000000e2'; // ainda não enviado (fotos de outra pessoa)

const salvarChecklist = (id: string, veiculo: string, motorista: string, km: number) =>
  db.query(
    `select public.salvar_checklist($1, 'diario'::public.checklist_tipo, $2, $3, null, $4, $5::jsonb, '{"vazamento_avaria": false}'::jsonb)`,
    [
      id, veiculo, motorista, km,
      JSON.stringify(DIARIO.map((c) => ({ categoria_foto: c, foto_url: `${F_SP}/${id}/${c}.jpg`, severidade: 'ok', observacao: null, marcadores: [] }))),
    ],
  );

describe('checklist feito pelo motorista', () => {
  it('faz o checklist do próprio veículo, em seu nome; o KM do veículo é atualizado', async () => {
    await as(DRV_1, async () => {
      await salvarChecklist(CK_1, V_1, M_1, 1600);
      expect(await ids('select id from public.checklists')).toEqual([CK_1]);
      expect(await rows('select count(*)::int as n from public.checklist_fotos')).toEqual([{ n: 15 }]);
    });
    expect(await rows('select supervisor_id, motorista_id from public.checklists where id = $1', [CK_1])).toEqual([
      { supervisor_id: DRV_1, motorista_id: M_1 },
    ]);
    expect(await rows('select km_atual from public.veiculos where id = $1', [V_1])).toEqual([{ km_atual: 1600 }]);
  });

  it('não faz checklist de veículo que não é dele, de outra filial nem em nome de outro motorista', async () => {
    const outro = '40000000-0000-4000-8000-0000000000f1';
    await as(DRV_1, async () => {
      await expect(salvarChecklist(outro, V_2, M_1, 2100)).rejects.toThrow(/sem permissão/);
      await expect(salvarChecklist(outro, V_RJ, M_1, 5100)).rejects.toThrow(/sem permissão/);
      await expect(salvarChecklist(outro, V_1, M_2, 1700)).rejects.toThrow(/row-level security/);
    });
    await as(DRV_2, async () => {
      await expect(salvarChecklist(outro, V_1, M_2, 1700)).rejects.toThrow(/sem permissão/);
    });
    expect(await rows('select 1 from public.checklists where id = $1', [outro])).toHaveLength(0);
  });

  it('cada motorista vê só os checklists feitos em seu nome; o supervisor vê os da filial', async () => {
    await as(SUP_SP, async () => {
      await salvarChecklist(CK_SUP_M1, V_1, M_1, 1650);
      await salvarChecklist(CK_SUP_M3, V_2, M_3, 2100);
    });
    await as(DRV_1, async () => expect(await ids('select id from public.checklists')).toEqual([CK_1, CK_SUP_M1]));
    await as(DRV_2, async () => expect(await ids('select id from public.checklists')).toEqual([]));
    await as(SUP_SP, async () => expect(await ids('select id from public.checklists')).toEqual([CK_1, CK_SUP_M1, CK_SUP_M3]));
    await as(SUP_RJ, async () => expect(await ids('select id from public.checklists')).toEqual([]));
  });

  it('o checklist enviado não muda para o motorista', async () => {
    await as(DRV_1, async () => {
      expect((await db.query(`update public.checklists set status = 'ok' where id = $1`, [CK_1])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.checklist_fotos where checklist_id = $1`, [CK_1])).affectedRows).toBe(0);
    });
  });
});

describe('Storage do checklist (motorista)', () => {
  const enviar = (name: string, dono: string) =>
    db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('checklists', $1, $2)`, [name, dono]);
  const nomes = async () =>
    (await rows<{ name: string }>(`select name from storage.objects where bucket_id = 'checklists' order by name`)).map((r) => r.name);

  beforeAll(async () => {
    // fotos enviadas por outras pessoas (o Storage grava o uid de quem enviou em owner_id)
    await db.exec(`
      insert into storage.objects (bucket_id, name, owner_id) values
        ('checklists', '${F_SP}/${CK_SUP_M1}/frente.jpg', '${SUP_SP}'),
        ('checklists', '${F_SP}/${CK_SUP_M3}/frente.jpg', '${SUP_SP}'),
        ('checklists', '${F_SP}/${CK_RASCUNHO_2}/frente.jpg', '${SUP_SP}'),
        ('checklists', '${F_SP}/${CK_1}/frente.jpg', '${DRV_1}');
    `);
  });

  it('envia fotos só na pasta da própria filial e só de checklist ainda não enviado', async () => {
    await as(DRV_1, async () => {
      await enviar(`${F_SP}/${CK_RASCUNHO_1}/frente.jpg`, DRV_1);
      await expect(enviar(`${F_RJ}/${CK_RASCUNHO_1}/traseira.jpg`, DRV_1)).rejects.toThrow(/row-level security/);
      await expect(enviar(`${F_SP}/${CK_1}/traseira.jpg`, DRV_1)).rejects.toThrow(/row-level security/);
      await expect(enviar(`${F_SP}/${CK_RASCUNHO_1}/extra/traseira.jpg`, DRV_1)).rejects.toThrow(/row-level security/);
    });
    // motorista sem veículo não envia foto de checklist
    await as(DRV_2, async () => {
      await expect(enviar(`${F_SP}/${CK_RASCUNHO_2}/traseira.jpg`, DRV_2)).rejects.toThrow(/row-level security/);
    });
  });

  it('vê as próprias fotos e as dos checklists feitos em seu nome; não as de outros', async () => {
    await as(DRV_1, async () => {
      expect(await nomes()).toEqual([
        `${F_SP}/${CK_1}/frente.jpg`,
        `${F_SP}/${CK_SUP_M1}/frente.jpg`,
        `${F_SP}/${CK_RASCUNHO_1}/frente.jpg`,
      ].sort());
    });
    await as(DRV_2, async () => expect(await nomes()).toEqual([]));
  });

  it('refaz a foto (upsert) só no próprio arquivo e só antes do envio', async () => {
    const refazer = (name: string) => db.query(`update storage.objects set name = name where bucket_id = 'checklists' and name = $1`, [name]);
    await as(DRV_1, async () => {
      expect((await refazer(`${F_SP}/${CK_RASCUNHO_1}/frente.jpg`)).affectedRows).toBe(1);
      expect((await refazer(`${F_SP}/${CK_1}/frente.jpg`)).affectedRows).toBe(0); // já enviado
      expect((await refazer(`${F_SP}/${CK_RASCUNHO_2}/frente.jpg`)).affectedRows).toBe(0); // de outra pessoa
    });
  });
});

describe('remover o acesso do motorista', () => {
  it('apagar o login desvincula o cadastro e preserva os abastecimentos', async () => {
    await db.query(`delete from auth.users where id = $1`, [DRV_1]);
    expect(await rows('select user_id from public.motoristas where id = $1', [M_1])).toEqual([{ user_id: null }]);
    const lancamentos = await rows<{ motorista_id: string; registrado_por: string | null }>(
      'select motorista_id, registrado_por from public.abastecimentos where motorista_id = $1',
      [M_1],
    );
    expect(lancamentos).toHaveLength(2);
    expect(lancamentos.every((l) => l.registrado_por === null)).toBe(true);
    // o checklist que ele fez continua no histórico, ligado ao cadastro
    expect(await rows('select supervisor_id, motorista_id from public.checklists where id = $1', [CK_1])).toEqual([
      { supervisor_id: null, motorista_id: M_1 },
    ]);
  });

  it('supervisor com checklists registrados continua sem poder ser excluído', async () => {
    await expect(db.query(`delete from auth.users where id = $1`, [SUP_SP])).rejects.toThrow(/checklists registrados/);
    expect(await rows('select 1 from public.profiles where id = $1', [SUP_SP])).toHaveLength(1);
  });
});
