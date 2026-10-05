'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin, requireSession } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { proximaRevisao } from '@/lib/maintenance/alerts';
import { sincronizarAlertas } from '@/lib/maintenance/sync';
import { concluirManutencaoSchema, flattenErrors, formDataToObject, manutencaoSchema } from '@/lib/schemas';

/**
 * Registra uma manutenção e recalcula os alertas.
 *  - A filial vem do VEÍCULO (nunca do formulário).
 *  - Preventiva: define o próximo vencimento (KM + intervalo, data + intervalo) no veículo,
 *    desde que seja a preventiva mais recente (lançamentos retroativos não "voltam" o plano).
 *  - Sempre: o KM do veículo só avança.
 */
export async function registrarManutencao(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireSession();
  const parsed = manutencaoSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const m = parsed.data;

  const { data: veiculo } = await supabase
    .from('veiculos')
    .select('id, filial_id, km_atual, intervalo_revisao_km, intervalo_revisao_dias')
    .eq('id', m.veiculo_id)
    .maybeSingle();
  if (!veiculo) return fail('Veículo não encontrado.');

  const plano =
    m.tipo === 'preventiva'
      ? proximaRevisao({
          kmRegistro: m.km_registro,
          dataManutencao: m.data_manutencao,
          intervaloKm: veiculo.intervalo_revisao_km,
          intervaloDias: veiculo.intervalo_revisao_dias,
        })
      : null;

  // a preventiva é a mais recente? (para decidir se ela redefine o plano do veículo)
  let redefinePlano = false;
  if (m.tipo === 'preventiva') {
    const { data: ultima } = await supabase
      .from('manutencoes')
      .select('data_manutencao')
      .eq('veiculo_id', veiculo.id)
      .eq('tipo', 'preventiva')
      .order('data_manutencao', { ascending: false })
      .limit(1)
      .maybeSingle();
    redefinePlano = !ultima || m.data_manutencao >= ultima.data_manutencao;
  }

  const { data: criada, error } = await supabase
    .from('manutencoes')
    .insert({
      veiculo_id: veiculo.id,
      filial_id: veiculo.filial_id,
      tipo: m.tipo,
      descricao: m.descricao,
      custo: m.custo,
      km_registro: m.km_registro,
      data_manutencao: m.data_manutencao,
      fornecedor: m.fornecedor ?? null,
      proxima_revisao_km: plano?.km ?? null,
      proxima_revisao_data: plano?.data ?? null,
    })
    .select('id')
    .single();
  if (error) return fail(friendlyDbError(error));

  const { error: veiculoError } = await supabase
    .from('veiculos')
    .update({
      km_atual: Math.max(veiculo.km_atual, m.km_registro),
      ...(redefinePlano && plano ? { proxima_revisao_km: plano.km, proxima_revisao_data: plano.data } : {}),
    })
    .eq('id', veiculo.id);

  if (redefinePlano) {
    // preventivas anteriores deixam de carregar alerta
    await supabase
      .from('manutencoes')
      .update({ status_alerta: 'ok' })
      .eq('veiculo_id', veiculo.id)
      .eq('tipo', 'preventiva')
      .neq('id', criada.id);
  }
  await sincronizarAlertas(supabase, { veiculoId: veiculo.id }).catch((e) => console.error('[alertas]', e));

  revalidatePath('/manutencoes');
  revalidatePath('/dashboard');
  revalidatePath(`/veiculos/${veiculo.id}`);

  if (veiculoError) {
    return fail('Manutenção registrada, mas não foi possível atualizar o KM/plano do veículo. Edite o veículo manualmente.');
  }
  redirect('/manutencoes');
}

export async function excluirManutencao(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const { error, count } = await supabase.from('manutencoes').delete({ count: 'exact' }).eq('id', id);
  if (error) return fail(friendlyDbError(error));
  if (!count) return fail('Manutenção não encontrada.');
  revalidatePath('/manutencoes');
  revalidatePath('/dashboard');
  return ok('Manutenção excluída.');
}

/**
 * Conclui uma manutenção aberta (ex.: o conserto da avaria apontada no checklist).
 * O banco marca quem concluiu e LIBERA o veículo bloqueado por ela (gatilho da migration
 * 20260107). O KM do veículo só avança.
 */
export async function concluirManutencao(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireSession();
  const parsed = concluirManutencaoSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const c = parsed.data;

  const { data: atual } = await supabase.from('manutencoes').select('id, veiculo_id, situacao').eq('id', c.id).maybeSingle();
  if (!atual) return fail('Manutenção não encontrada.');
  if (atual.situacao !== 'aberta') return fail('Esta manutenção já foi concluída.');

  const { error, count } = await supabase
    .from('manutencoes')
    .update(
      {
        situacao: 'concluida',
        descricao: c.descricao,
        custo: c.custo,
        km_registro: c.km_registro,
        data_manutencao: c.data_manutencao,
        fornecedor: c.fornecedor ?? null,
      },
      { count: 'exact' },
    )
    .eq('id', c.id)
    .eq('situacao', 'aberta');
  if (error) return fail(friendlyDbError(error));
  if (!count) return fail('Esta manutenção já foi concluída.');

  const { data: veiculo } = await supabase.from('veiculos').select('id, km_atual').eq('id', atual.veiculo_id).maybeSingle();
  if (veiculo && c.km_registro > veiculo.km_atual) {
    await supabase.from('veiculos').update({ km_atual: c.km_registro }).eq('id', veiculo.id);
  }
  await sincronizarAlertas(supabase, { veiculoId: atual.veiculo_id }).catch((e) => console.error('[alertas]', e));

  revalidatePath('/manutencoes');
  revalidatePath('/dashboard');
  revalidatePath('/veiculos');
  revalidatePath(`/veiculos/${atual.veiculo_id}`);
  revalidatePath('/meu-veiculo');
  redirect(`/veiculos/${atual.veiculo_id}`);
}
