/**
 * Atualização de um banco já em uso: checklists antigos (14 fotos fixas) gravados ANTES da
 * migration 20260105 continuam íntegros e legíveis depois dela.
 */
import { describe, expect, it } from 'vitest';
import { criarBanco } from './banco';

const SUP = '00000000-0000-4000-8000-0000000000b1';
const F = '10000000-0000-4000-8000-000000000001';
const V = '20000000-0000-4000-8000-000000000001';
const M = '30000000-0000-4000-8000-000000000001';
const CK = '40000000-0000-4000-8000-000000000001';

// as 14 categorias do enum antigo
const ANTIGAS = [
  'lateral_direita', 'lateral_esquerda', 'frente', 'traseira', 'carroceria_portamalas', 'interior', 'painel',
  'rodas', 'nivel_oleo', 'nivel_agua', 'motor', 'retrovisores', 'para_brisa', 'luzes_sinalizacao',
];

describe('atualização para os checklists por tipo (20260105)', () => {
  it('mantém os checklists antigos como diários, com fotos e status', async () => {
    const { db, as, rows, aplicarPendentes } = await criarBanco({ antesDe: '20260105000000' });
    await db.exec(`
      insert into auth.users (id, email) values ('${SUP}', 'sp@x.com');
      insert into public.filiais (id, nome_cidade, uf) values ('${F}', 'São Paulo', 'SP');
      insert into public.profiles (id, nome, role, filial_id) values ('${SUP}', 'Sup SP', 'supervisor', '${F}');
      insert into public.veiculos (id, filial_id, placa, km_atual) values ('${V}', '${F}', 'ABC1D23', 1000);
      insert into public.motoristas (id, filial_id, nome, cpf, email, whatsapp, cnh) values
        ('${M}', '${F}', 'Motorista SP', '52998224725', 'sp@m.com', '5511999990001', '22522791508');
    `);
    const fotos = ANTIGAS.map((c) => ({
      categoria_foto: c,
      foto_url: `${F}/${CK}/${c}.jpg`,
      severidade: c === 'rodas' ? 'atencao' : 'ok',
      observacao: c === 'rodas' ? 'pneu gasto' : null,
      marcadores: [],
    }));
    await as(SUP, () =>
      db.query('select public.salvar_checklist($1, $2, $3, $4, $5, $6::jsonb)', [CK, V, M, null, 1200, JSON.stringify(fotos)]),
    );

    await aplicarPendentes();

    const [ck] = await rows<{ tipo: string; status: string; respostas: unknown; km_registro: number }>(
      `select tipo, status, respostas, km_registro from public.checklists where id = '${CK}'`,
    );
    expect(ck).toEqual({ tipo: 'diario', status: 'atencao', respostas: {}, km_registro: 1200 });

    // o supervisor continua vendo as 14 fotos, cada uma ligada a um item (inativo) do catálogo
    const vistas = await as(SUP, () =>
      rows<{ categoria_foto: string; grupo: string; ativo: boolean }>(
        `select f.categoria_foto, i.grupo, i.ativo from public.checklist_fotos f
           join public.checklist_itens i on i.codigo = f.categoria_foto
          where f.checklist_id = '${CK}'`,
      ),
    );
    expect(vistas).toHaveLength(14);
    expect(vistas.find((f) => f.categoria_foto === 'rodas')).toEqual({ categoria_foto: 'rodas', grupo: 'Pneus', ativo: false });
    expect(vistas.find((f) => f.categoria_foto === 'nivel_oleo')?.ativo).toBe(true);
  });
});
