/**
 * Notificações por push (migration 20260113): aparelhos e disparos só existem para o servidor
 * (service role); nenhum usuário logado lê ou grava; o mesmo aparelho é de um usuário só.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarBanco } from './banco';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const DRV = '00000000-0000-4000-8000-0000000000c1';
const DESTINO = 'https://fcm.googleapis.com/fcm/send/' + 'x'.repeat(40);

let db: PGlite;
let as: Awaited<ReturnType<typeof criarBanco>>['as'];

beforeAll(async () => {
  ({ db, as } = await criarBanco());
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@x.com'), ('${DRV}', 'drv@x.com');
    insert into public.profiles (id, nome, role, filial_id) values ('${ADMIN}', 'Admin', 'admin', null);
  `);
});

describe('push_dispositivos e push_disparos', () => {
  it('nem o admin (pelo app) lê ou grava: só o servidor', async () => {
    await as(ADMIN, async () => {
      await expect(db.query('select * from public.push_dispositivos')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.push_disparos')).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`insert into public.push_dispositivos (user_id, tipo, destino) values ($1, 'fcm', $2)`, [ADMIN, DESTINO]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('o servidor guarda aparelhos; o mesmo destino é de um usuário só (quem entrou por último assume)', async () => {
    await db.query(`insert into public.push_dispositivos (user_id, tipo, destino) values ($1, 'fcm', $2)`, [ADMIN, DESTINO]);
    await expect(
      db.query(`insert into public.push_dispositivos (user_id, tipo, destino) values ($1, 'fcm', $2)`, [ADMIN, DESTINO]),
    ).rejects.toThrow(/unique/);
    const r = await db.query<{ user_id: string }>(
      `insert into public.push_dispositivos (user_id, tipo, destino) values ($1, 'fcm', $2)
       on conflict (destino) do update set user_id = excluded.user_id returning user_id`,
      [ADMIN, DESTINO],
    );
    expect(r.rows[0]!.user_id).toBe(ADMIN);
  });

  it('aparelho do navegador exige as chaves; tipo inválido é recusado', async () => {
    await expect(
      db.query(`insert into public.push_dispositivos (user_id, tipo, destino) values ($1, 'web', $2)`, [ADMIN, DESTINO + 'w']),
    ).rejects.toThrow(/push_dispositivos_web_chaves_chk/);
    await expect(
      db.query(`insert into public.push_dispositivos (user_id, tipo, destino) values ($1, 'sms', $2)`, [ADMIN, DESTINO + 's']),
    ).rejects.toThrow(/check/);
    await db.query(
      `insert into public.push_dispositivos (user_id, tipo, destino, chave_p256dh, chave_auth) values ($1, 'web', $2, 'p', 'a')`,
      [ADMIN, DESTINO + 'ok'],
    );
  });

  it('apagar o usuário apaga os aparelhos dele', async () => {
    await db.query(`delete from public.profiles where id = $1`, [ADMIN]);
    expect((await db.query('select 1 from public.push_dispositivos')).rows).toHaveLength(0);
  });

  it('um disparo por horário e dia (garante que o lembrete sai uma vez)', async () => {
    const ins = () => db.query(`insert into public.push_disparos (momento, dia) values ('0800', '2026-10-22') on conflict do nothing returning momento`);
    expect((await ins()).rows).toHaveLength(1);
    expect((await ins()).rows).toHaveLength(0);
    await expect(db.query(`insert into public.push_disparos (momento, dia) values ('0900', '2026-10-22')`)).rejects.toThrow(/check/);
  });
});
