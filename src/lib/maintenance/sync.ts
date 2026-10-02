import type { SupabaseClient } from '@supabase/supabase-js';
import { toISODate } from '@/lib/dates';
import type { Database } from '@/types/database';
import { calcularAlertaRevisao, type NivelAlerta } from './alerts';

type Client = SupabaseClient<Database>;

export interface ResumoAlertas {
  veiculos: number;
  vencidos: number;
  proximos: number;
  /** quantidade de registros de manutenção cujo status_alerta mudou */
  atualizados: number;
}

const PAGE = 1000;
const CHUNK = 100;

/**
 * Recalcula o alerta de revisão e persiste `manutencoes.status_alerta` na última
 * preventiva de cada veículo (a que "carrega" o plano vigente).
 *
 * Quem chama decide o escopo pela PRÓPRIA RLS do cliente: com o cliente do usuário só
 * enxerga a(s) filial(is) dele; com o cliente admin (cron) varre a frota inteira.
 */
export async function sincronizarAlertas(
  supabase: Client,
  filtro: { veiculoId?: string; filialId?: string } = {},
): Promise<ResumoAlertas> {
  const hoje = toISODate();
  const resumo: ResumoAlertas = { veiculos: 0, vencidos: 0, proximos: 0, atualizados: 0 };
  const idsPorNivel: Record<NivelAlerta, string[]> = { ok: [], proximo: [], vencido: [] };

  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from('vw_veiculos_painel')
      .select('id, km_atual, proxima_revisao_km, proxima_revisao_data, ultima_preventiva_id')
      .order('id')
      .range(from, from + PAGE - 1);
    if (filtro.veiculoId) query = query.eq('id', filtro.veiculoId);
    if (filtro.filialId) query = query.eq('filial_id', filtro.filialId);

    const { data, error } = await query;
    if (error) throw new Error(`Falha ao carregar veículos para alertas: ${error.message}`);

    for (const v of data ?? []) {
      const { nivel } = calcularAlertaRevisao(
        { kmAtual: v.km_atual, proximaRevisaoKm: v.proxima_revisao_km, proximaRevisaoData: v.proxima_revisao_data },
        hoje,
      );
      resumo.veiculos++;
      if (nivel === 'vencido') resumo.vencidos++;
      if (nivel === 'proximo') resumo.proximos++;
      if (v.ultima_preventiva_id) idsPorNivel[nivel].push(v.ultima_preventiva_id);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }

  for (const nivel of ['ok', 'proximo', 'vencido'] as const) {
    const ids = idsPorNivel[nivel];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('manutencoes')
        .update({ status_alerta: nivel })
        .in('id', ids.slice(i, i + CHUNK))
        .neq('status_alerta', nivel)
        .select('id');
      if (error) throw new Error(`Falha ao atualizar status de alerta: ${error.message}`);
      resumo.atualizados += data?.length ?? 0;
    }
  }
  return resumo;
}
