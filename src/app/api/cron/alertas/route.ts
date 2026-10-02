import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { sincronizarAlertas } from '@/lib/maintenance/sync';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Cron diário (vercel.json): recalcula os alertas de revisão por KM/período de TODA a frota.
 * A Vercel chama com "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });
  try {
    const resumo = await sincronizarAlertas(createAdminClient());
    return Response.json({ ok: true, ...resumo });
  } catch (error) {
    console.error('[cron/alertas]', error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
