import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { getSupabasePublicEnv } from './env';

/**
 * Cliente para Server Components, Server Actions e Route Handlers.
 * Autentica como o USUÁRIO (cookies de sessão) => a RLS do Postgres é sempre aplicada.
 * Memoizado por requisição com React.cache.
 */
export const createClient = cache(async () => {
  // cookies() primeiro: marca a rota como dinâmica (nunca pré-renderizada), mesmo se faltar env no build
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado de um Server Component (cookies somente-leitura): o proxy
          // já renova a sessão a cada requisição, então é seguro ignorar.
        }
      },
    },
  });
});
