import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, toISODate } from '@/lib/dates';
import { resolveFilialFilter, type SearchParams } from '@/lib/pagination';
import type { Database } from '@/types/database';
import { montarAcompanhamento, SITUACOES, type RegistroAbastecimento, type SituacaoFiltro } from './acompanhamento';
import { COMBUSTIVEIS, type Combustivel } from './consumo';

/** Histórico antes do período para fechar o km/l do 1º tanque e ter a referência de consumo. */
const DIAS_DE_HISTORICO = 180;
const MAX_REGISTROS = 5000;

export interface ParametrosAcompanhamento {
  de: string;
  ate: string;
  filialId: string | null;
  veiculoId: string | null;
  motoristaId: string | null;
  combustivel: Combustivel | null;
  posto: string | null;
  situacao: SituacaoFiltro;
}

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const data = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** Filtros da URL (padrão: o mês atual até hoje). */
export function lerParametros(
  sp: SearchParams,
  session: Parameters<typeof resolveFilialFilter>[0],
): ParametrosAcompanhamento {
  const hoje = toISODate();
  let de = data(um(sp.de)) ?? `${hoje.slice(0, 8)}01`;
  let ate = data(um(sp.ate)) ?? hoje;
  if (de > ate) [de, ate] = [ate, de];
  // no máximo 1 ano de uma vez (a página fica rápida)
  if (addDays(de, 366) < ate) de = addDays(ate, -366);
  const combustivel = COMBUSTIVEIS.find((c) => c.value === um(sp.combustivel))?.value ?? null;
  const situacao = SITUACOES.find((s) => s.value === um(sp.situacao))?.value ?? 'todos';
  const posto = um(sp.posto)?.trim().slice(0, 80) || null;
  return {
    de,
    ate,
    filialId: resolveFilialFilter(session, sp),
    veiculoId: uuid(um(sp.veiculo)),
    motoristaId: uuid(um(sp.motorista)),
    combustivel,
    posto,
    situacao,
  };
}

/** Busca (a RLS limita o supervisor à própria filial) e monta o acompanhamento. */
export async function carregarAcompanhamento(supabase: SupabaseClient<Database>, p: ParametrosAcompanhamento) {
  let q = supabase
    .from('abastecimentos')
    .select(
      'id, veiculo_id, motorista_id, data_abastecimento, created_at, km, litros, valor_bruto, desconto, valor_total, preco_litro, combustivel, tanque_cheio, posto, comprovante_url, observacao, leitura_cupom, veiculos(placa, modelo), motoristas(nome)',
    )
    .gte('data_abastecimento', addDays(p.de, -DIAS_DE_HISTORICO))
    .lte('data_abastecimento', p.ate)
    .order('data_abastecimento', { ascending: false })
    .limit(MAX_REGISTROS);
  if (p.filialId) q = q.eq('filial_id', p.filialId);
  if (p.veiculoId) q = q.eq('veiculo_id', p.veiculoId);
  const { data: registros } = await q;
  return montarAcompanhamento((registros ?? []) as unknown as RegistroAbastecimento[], {
    de: p.de,
    ate: p.ate,
    combustivel: p.combustivel,
    posto: p.posto,
    situacao: p.situacao,
    motoristaId: p.motoristaId,
  });
}

/** A mesma consulta em forma de URL (link da exportação e da paginação). */
export function paramsDaUrl(p: ParametrosAcompanhamento, isAdmin: boolean): URLSearchParams {
  const u = new URLSearchParams({ de: p.de, ate: p.ate });
  if (p.filialId && isAdmin) u.set('filial', p.filialId);
  if (p.veiculoId) u.set('veiculo', p.veiculoId);
  if (p.motoristaId) u.set('motorista', p.motoristaId);
  if (p.combustivel) u.set('combustivel', p.combustivel);
  if (p.posto) u.set('posto', p.posto);
  if (p.situacao !== 'todos') u.set('situacao', p.situacao);
  return u;
}
