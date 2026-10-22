import { getSession } from '@/lib/auth';
import { aparelhosDoUsuario } from '@/lib/push/dispositivos';
import { enviarParaAlvos } from '@/lib/push/enviar';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Envia uma notificação de teste para os aparelhos do usuário logado (confere se o push chega na hora). */
export async function POST() {
  const session = await getSession();
  if (!session) return Response.json({ ok: false }, { status: 401 });
  const alvos = await aparelhosDoUsuario(session.user.id);
  if (!alvos.length) return Response.json({ ok: false, motivo: 'nenhum aparelho cadastrado' });
  const r = await enviarParaAlvos(createAdminClient(), alvos, {
    id: 'teste',
    titulo: 'Rodar: teste de notificação',
    texto: 'Se você viu esta mensagem, os avisos do checklist vão chegar na hora neste aparelho.',
    url: '/',
  });
  return Response.json({ ok: r.enviados > 0, ...r });
}
