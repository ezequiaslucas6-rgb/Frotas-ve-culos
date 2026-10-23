import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Aparelhos de push. Gravado com o cliente admin (a tabela não tem política para o usuário):
 * o mesmo aparelho (destino) só pode ser de um usuário, e quem entrou por último assume.
 */
export async function registrarDispositivo(d: {
  userId: string;
  tipo: 'web' | 'fcm';
  destino: string;
  chaveP256dh?: string;
  chaveAuth?: string;
  userAgent?: string | null;
}) {
  const { data, error } = await createAdminClient()
    .from('push_dispositivos')
    .upsert(
      {
        user_id: d.userId,
        tipo: d.tipo,
        destino: d.destino,
        chave_p256dh: d.chaveP256dh ?? null,
        chave_auth: d.chaveAuth ?? null,
        user_agent: d.userAgent?.slice(0, 300) ?? null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'destino' },
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** Cookie com o aparelho deste navegador/app: o "Sair" usa para parar de avisar quem saiu. */
export const COOKIE_APARELHO = 'frotas_push';

export const cookieDoAparelho = (id: string, https: boolean) =>
  `${COOKIE_APARELHO}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;

/** Remove o aparelho pelo id (cookie), só se for do usuário. */
export async function removerDispositivoPorId(userId: string, id: string) {
  await createAdminClient().from('push_dispositivos').delete().eq('id', id).eq('user_id', userId);
}

/** Remove o aparelho, só se for do usuário. */
export async function removerDispositivo(userId: string, destino: string) {
  await createAdminClient().from('push_dispositivos').delete().eq('destino', destino).eq('user_id', userId);
}

/** Aparelhos do usuário (para a notificação de teste). */
export async function aparelhosDoUsuario(userId: string) {
  const { data } = await createAdminClient()
    .from('push_dispositivos')
    .select('id, tipo, destino, chave_p256dh, chave_auth')
    .eq('user_id', userId);
  return data ?? [];
}
