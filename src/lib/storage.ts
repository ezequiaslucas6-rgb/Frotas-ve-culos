import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/auth';
import { caminhoMiniatura } from '@/lib/storage-paths';
import type { Database } from '@/types/database';

export type BucketName = 'veiculos' | 'checklists' | 'motoristas' | 'abastecimentos' | 'perfis';

const TTL_SEGUNDOS = 6 * 60 * 60; // validade da URL assinada: 6 h
const REUSO_MS = (TTL_SEGUNDOS - 60 * 60) * 1000; // reaproveitada por até 5 h (sobra 1 h de validade)
const AUSENTE_MS = 10 * 60 * 1000; // arquivo inexistente (ex.: miniatura de upload antigo): não pergunta de novo por 10 min

/*
 * URLs assinadas em memória, POR USUÁRIO: a mesma foto mantém a mesma URL entre uma
 * tela e outra, então o navegador usa o cache dele em vez de baixar tudo de novo (e o
 * servidor não pede uma assinatura nova ao Supabase a cada navegação). Os arquivos
 * são imutáveis — todo upload grava um nome novo —, logo a URL nunca fica "velha".
 */
const assinaturas = new Map<string, { url: string | null; expira: number }>();

/**
 * Gera URLs assinadas (os buckets são privados). A assinatura roda com a sessão do
 * usuário, então a RLS do Storage também vale: caminhos de outra filial não assinam.
 * Retorna um mapa caminho -> URL (só dos arquivos que existem e o usuário pode ler).
 */
export async function signedUrlMap(
  supabase: SupabaseClient<Database>,
  bucket: BucketName,
  paths: Array<string | null | undefined>,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (unique.length === 0) return {};

  const escopo = (await getSession())?.user.id;
  const chave = (path: string) => `${escopo}|${bucket}|${path}`;
  const agora = Date.now();
  const map: Record<string, string> = {};
  const faltam: string[] = [];
  for (const path of unique) {
    const salvo = escopo ? assinaturas.get(chave(path)) : undefined;
    if (salvo && salvo.expira > agora) {
      if (salvo.url) map[path] = salvo.url;
    } else {
      faltam.push(path);
    }
  }
  if (faltam.length === 0) return map;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(faltam, TTL_SEGUNDOS);
  if (error || !data) return map;
  if (assinaturas.size > 5000) for (const [k, v] of assinaturas) if (v.expira <= agora) assinaturas.delete(k);
  for (const item of data) {
    if (!item.path) continue;
    if (item.signedUrl) map[item.path] = item.signedUrl;
    if (escopo) {
      assinaturas.set(chave(item.path), item.signedUrl
        ? { url: item.signedUrl, expira: agora + REUSO_MS }
        : { url: null, expira: agora + AUSENTE_MS });
    }
  }
  return map;
}

/**
 * Miniaturas para listas (poucos KB cada), com a imagem completa como reserva para
 * arquivos enviados antes de existir miniatura. Uma única chamada ao Storage.
 */
export async function signedThumbMap(
  supabase: SupabaseClient<Database>,
  bucket: BucketName,
  paths: Array<string | null | undefined>,
): Promise<Record<string, string>> {
  const imagens = paths.filter((p): p is string => Boolean(p) && !/\.pdf$/i.test(p!));
  const urls = await signedUrlMap(supabase, bucket, [...imagens.map(caminhoMiniatura), ...imagens]);
  return Object.fromEntries(imagens.flatMap((p) => {
    const url = urls[caminhoMiniatura(p)] ?? urls[p];
    return url ? [[p, url]] : [];
  }));
}
