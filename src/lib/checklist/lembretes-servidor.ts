import type { SupabaseClient } from '@supabase/supabase-js';
import { inicioDaBusca, periodosCobranca, situacaoCobranca, situacaoDiaria, situacaoSemanal } from '@/lib/checklist/cobranca';
import { lembreteSupervisor, lembretesMotorista, type Momento, type Notificacao, type VeiculoLembrete } from '@/lib/checklist/lembretes';
import { inicioDoDia, toISODate } from '@/lib/dates';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import type { Database } from '@/types/database';

/** De quem são os lembretes: o motorista (veículos dele), o supervisor (filial) ou o admin (frota). */
export type EscopoLembrete =
  | { papel: 'motorista'; motoristaId: string; folgas: readonly string[] }
  | { papel: 'supervisor'; filialId: string }
  | { papel: 'admin' };

/** Motorista recebe às 08:00; supervisor e admin, às 08:30. */
export const momentoDoPapel = (papel: EscopoLembrete['papel']): Momento => (papel === 'motorista' ? '0800' : '0830');

/**
 * O que avisar a alguém em `momento`. Usado pelo app (alarme local do APK, com o cliente do
 * usuário) e pelo agendador do servidor (cliente admin): o escopo vem SEMPRE explícito nos
 * filtros, então dá o mesmo resultado com ou sem a RLS.
 */
export async function carregarNotificacoes(
  supabase: SupabaseClient<Database>,
  escopo: EscopoLembrete,
  momento: Momento,
  agora: Date = new Date(),
): Promise<Notificacao[]> {
  if (momento !== momentoDoPapel(escopo.papel)) return [];
  const hoje = toISODate(agora);

  if (escopo.papel === 'motorista') {
    const periodos = periodosCobranca(hoje);
    const { data: veiculos } = await supabase
      .from('veiculos')
      .select('id, placa, created_at')
      .eq('motorista_id', escopo.motoristaId)
      .order('placa');
    const lista = veiculos ?? [];
    if (!lista.length) return [];
    const ids = lista.map((v) => v.id);
    const [{ data: checklists }, { data: decisoes }, { data: bloqueios }] = await Promise.all([
      supabase.from('checklists').select('veiculo_id, tipo, data_envio').in('veiculo_id', ids).gte('data_envio', inicioDoDia(inicioDaBusca(periodos))),
      supabase.from('liberacoes_diarias').select('veiculo_id, liberado').in('veiculo_id', ids).eq('dia', hoje),
      supabase.from('veiculo_bloqueios').select('veiculo_id').in('veiculo_id', ids).is('liberado_em', null),
    ]);
    const feitos = situacaoCobranca(ids, checklists ?? [], hoje);
    const itens: VeiculoLembrete[] = lista.map((v) => {
      const s = feitos.get(v.id)!;
      return {
        id: v.id,
        placa: v.placa,
        semanal: situacaoSemanal(s.semanal, hoje, v.created_at, escopo.folgas),
        diaria: situacaoDiaria(s.diario, (decisoes ?? []).find((d) => d.veiculo_id === v.id)?.liberado ?? null, agora, escopo.folgas),
        parado: (bloqueios ?? []).some((b) => b.veiculo_id === v.id),
      };
    });
    return lembretesMotorista(itens);
  }

  // supervisor: a filial dele; admin: a frota inteira
  let consulta = supabase.from('vw_veiculos_painel').select('*');
  if (escopo.papel === 'supervisor') consulta = consulta.eq('filial_id', escopo.filialId);
  const { data } = await consulta;
  const itens: VeiculoLembrete[] = (data ?? []).map((v) => {
    const a = avaliarVeiculoPainel(v, hoje, agora);
    return { id: v.id, placa: v.placa, semanal: a.semanal, diaria: a.diaria, parado: a.bloqueio === 'avaria' };
  });
  return lembreteSupervisor(itens);
}
