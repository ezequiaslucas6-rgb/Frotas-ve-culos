import { getSession } from '@/lib/auth';
import { carregarNotificacoes, momentoDoPapel, type EscopoLembrete } from '@/lib/checklist/lembretes-servidor';
import type { Momento } from '@/lib/checklist/lembretes';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });

/**
 * O APK pergunta o que notificar no alarme local (rede de segurança do push do servidor): às
 * 08:00 (motorista) e às 08:30 (supervisor/admin). Usa a sessão do próprio app (cookies do
 * WebView): sem login, não há o que avisar.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ notificacoes: [] }, 401);
  const momento: Momento = new URL(request.url).searchParams.get('momento') === '0830' ? '0830' : '0800';
  const supabase = await createClient();
  const papel = session.profile.role;

  let escopo: EscopoLembrete;
  if (session.isMotorista) {
    // RLS: o motorista lê só o próprio cadastro
    const { data: eu } = await supabase.from('motoristas').select('id, dias_folga').maybeSingle();
    if (!eu) return json({ notificacoes: [], papel });
    escopo = { papel: 'motorista', motoristaId: eu.id, diasFolga: eu.dias_folga };
  } else if (papel === 'supervisor' && session.profile.filial_id) {
    escopo = { papel: 'supervisor', filialId: session.profile.filial_id };
  } else {
    escopo = { papel: 'admin' };
  }
  // o papel fica no celular: sem internet às 08:00, o motorista recebe um lembrete simples
  if (momento !== momentoDoPapel(escopo.papel)) return json({ notificacoes: [], papel });
  return json({ notificacoes: await carregarNotificacoes(supabase, escopo, momento), papel });
}
