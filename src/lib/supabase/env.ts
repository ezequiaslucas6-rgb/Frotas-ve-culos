/**
 * Acesso tipado às variáveis de ambiente do Supabase.
 * Atenção: NEXT_PUBLIC_* precisam ser referenciadas de forma estática
 * (process.env.NEXT_PUBLIC_X) para serem inlinadas no bundle do browser.
 */
export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Variáveis NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não configuradas (veja .env.example).',
    );
  }
  return { url, anonKey };
}
