import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { cookieDoAparelho, registrarDispositivo, removerDispositivo } from '@/lib/push/dispositivos';

export const dynamic = 'force-dynamic';

const assinatura = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Registra (ou renova) a assinatura de push deste navegador para o usuário logado. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false }, { status: 401 });
  const parsed = assinatura.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  const id = await registrarDispositivo({
    userId: session.user.id,
    tipo: 'web',
    destino: endpoint,
    chaveP256dh: keys.p256dh,
    chaveAuth: keys.auth,
    userAgent: request.headers.get('user-agent'),
  });
  return Response.json({ ok: true }, { headers: { 'set-cookie': cookieDoAparelho(id, new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https') } });
}

/** Cancela a assinatura deste navegador. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false }, { status: 401 });
  const parsed = z.object({ endpoint: z.url().max(2000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  await removerDispositivo(session.user.id, parsed.data.endpoint);
  return Response.json({ ok: true });
}
