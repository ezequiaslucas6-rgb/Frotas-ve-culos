import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type BucketName = 'veiculos' | 'checklists' | 'motoristas' | 'abastecimentos' | 'perfis';

const DEFAULT_TTL = 60 * 60; // 1h

/**
 * Gera URLs assinadas (os buckets são privados). A assinatura roda com a sessão do
 * usuário, então a RLS do Storage também vale: caminhos de outra filial não assinam.
 * Retorna um mapa caminho -> URL.
 */
export async function signedUrlMap(
  supabase: SupabaseClient<Database>,
  bucket: BucketName,
  paths: Array<string | null | undefined>,
  ttl = DEFAULT_TTL,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, ttl);
  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}
