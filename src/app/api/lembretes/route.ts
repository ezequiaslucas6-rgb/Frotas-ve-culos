import { getSession } from '@/lib/auth';
import { inicioDaBusca, periodosCobranca, situacaoCobranca, situacaoDiaria, situacaoSemanal } from '@/lib/checklist/cobranca';
import { lembreteSupervisor, lembretesMotorista, type Momento, type VeiculoLembrete } from '@/lib/checklist/lembretes';
import { inicioDoDia, toISODate } from '@/lib/dates';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });

/**
 * O APK pergunta às 08:00 (motorista) e às 08:30 (supervisor/admin) o que notificar.
 * Usa a sessão do próprio app (cookies do WebView): sem login, não há o que avisar.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ notificacoes: [] }, 401);
  const momento: Momento = new URL(request.url).searchParams.get('momento') === '0830' ? '0830' : '0800';
  const supabase = await createClient();
  const agora = new Date();
  const hoje = toISODate(agora);

  if (session.isMotorista) {
    if (momento !== '0800') return json({ notificacoes: [], papel: 'motorista' });
    // RLS: o motorista só recebe os veículos dele, os checklists feitos em seu nome e as decisões dos veículos dele
    const periodos = periodosCobranca(hoje);
    const [{ data: veiculos }, { data: checklists }, { data: decisoes }, { data: bloqueios }] = await Promise.all([
      supabase.from('veiculos').select('id, placa, created_at').order('placa'),
      supabase.from('checklists').select('veiculo_id, tipo, data_envio').gte('data_envio', inicioDoDia(inicioDaBusca(periodos))),
      supabase.from('liberacoes_diarias').select('veiculo_id, liberado').eq('dia', hoje),
      supabase.from('veiculo_bloqueios').select('veiculo_id').is('liberado_em', null),
    ]);
    const lista = veiculos ?? [];
    const feitos = situacaoCobranca(lista.map((v) => v.id), checklists ?? [], hoje);
    const itens: VeiculoLembrete[] = lista.map((v) => {
      const s = feitos.get(v.id)!;
      return {
        id: v.id,
        placa: v.placa,
        semanal: situacaoSemanal(s.semanal, hoje, v.created_at),
        diaria: situacaoDiaria(s.diario, (decisoes ?? []).find((d) => d.veiculo_id === v.id)?.liberado ?? null, agora),
        parado: (bloqueios ?? []).some((b) => b.veiculo_id === v.id),
      };
    });
    // o papel fica no celular: sem internet às 08:00, o motorista recebe um lembrete simples
    return json({ notificacoes: lembretesMotorista(itens), papel: 'motorista' });
  }

  const papel = session.profile.role;
  if (momento !== '0830') return json({ notificacoes: [], papel });
  // supervisor: a RLS limita à filial dele; admin: a frota inteira
  const { data } = await supabase.from('vw_veiculos_painel').select('*');
  const itens: VeiculoLembrete[] = (data ?? []).map((v) => {
    const a = avaliarVeiculoPainel(v, hoje, agora);
    return { id: v.id, placa: v.placa, semanal: a.semanal, diaria: a.diaria, parado: a.bloqueio === 'avaria' };
  });
  return json({ notificacoes: lembreteSupervisor(itens), papel });
}
