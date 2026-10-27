import { timingSafeEqual } from 'node:crypto';
import { toISODate } from '@/lib/dates';
import { dispararLembretes, reservarDisparo } from '@/lib/push/disparar';
import { momentoDeDisparo } from '@/lib/push/janela';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Agendador dos lembretes: o cron do servidor chama este endereço TODO minuto. Às 08:00 (motorista)
 * e às 08:30 (supervisor e admin), no horário de Pimenta Bueno, envia o push na hora; nos demais
 * minutos não faz nada. O mesmo horário nunca sai duas vezes no dia (tabela push_disparos), e se o
 * servidor estava fora no minuto exato, ainda envia até 15 minutos depois.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });
  const agora = new Date();
  const momento = momentoDeDisparo(agora);
  if (!momento) return Response.json({ ok: true, enviado: false });
  try {
    const supabase = createAdminClient();
    if (!(await reservarDisparo(supabase, momento, toISODate(agora), agora.getTime()))) {
      return Response.json({ ok: true, enviado: false, motivo: 'já enviado' });
    }
    return Response.json({ ok: true, enviado: true, ...(await dispararLembretes(supabase, momento, agora)) });
  } catch (error) {
    console.error('[cron/lembretes]', error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
