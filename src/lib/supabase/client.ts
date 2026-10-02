import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { getSupabasePublicEnv } from './env';

/** Cliente do browser (Client Components). Usa a sessão do usuário => a RLS se aplica. */
export function createClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
