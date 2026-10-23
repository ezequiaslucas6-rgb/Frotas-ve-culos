import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { cookieDoAparelho, registrarDispositivo, removerDispositivo } from '@/lib/push/dispositivos';

export const dynamic = 'force-dynamic';

const corpo = z.object({ token: z.string().min(20).max(4000) });

/** O APK registra o token do Firebase deste aparelho para o usuário logado (com a sessão do app). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false }, { status: 401 });
  const parsed = corpo.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const id = await registrarDispositivo({
    userId: session.user.id,
    tipo: 'fcm',
    destino: parsed.data.token,
    userAgent: request.headers.get('user-agent'),
  });
  return Response.json({ ok: true }, { headers: { 'set-cookie': cookieDoAparelho(id, new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https') } });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false }, { status: 401 });
  const parsed = corpo.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  await removerDispositivo(session.user.id, parsed.data.token);
  return Response.json({ ok: true });
}
