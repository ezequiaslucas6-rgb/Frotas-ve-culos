import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * Postgres embutido (PGlite) com o shim da plataforma Supabase e TODAS as
 * migrations aplicadas em ordem — cada arquivo numa execução própria, como no
 * SQL Editor (o valor novo de um enum só pode ser usado após o commit).
 */
export async function criarBanco() {
  const db = new PGlite();
  await db.exec(readFileSync(new URL('./supabase-shim.sql', import.meta.url), 'utf8'));
  const migrationsDir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(file, migrationsDir), 'utf8'));
  }

  /** Executa `fn` como um usuário autenticado (JWT sub = userId) ou como `anon`. */
  async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
    if (userId) {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    } else {
      await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    }
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }

  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;

  return { db, as, rows };
}
