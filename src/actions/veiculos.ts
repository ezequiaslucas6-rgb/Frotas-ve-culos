'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin, requireSession, resolveFilialId } from '@/lib/auth';
import { addDays, toISODate } from '@/lib/dates';
import { friendlyDbError } from '@/lib/db-errors';
import { sincronizarAlertas } from '@/lib/maintenance/sync';
import { decisaoDiariaSchema, flattenErrors, formDataToObject, liberarVeiculoSchema, veiculoSchema } from '@/lib/schemas';

/** Arquivos do veículo vivem em <filial_id>/... no bucket "veiculos". */
const MOTORISTA_INVALIDO = 'O motorista responsável precisa ser da mesma filial do veículo.';

const pathBelongsTo = (path: string | undefined, filialId: string) => !path || path.startsWith(`${filialId}/`);

export async function salvarVeiculo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const parsed = veiculoSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));

  const { id, filial_id: requestedFilial, documento_path, foto_geral_path, ...v } = parsed.data;

  // Em edição, a filial vem do próprio veículo (nunca do formulário).
  let filialId: string | null;
  if (id) {
    const { data } = await session.supabase.from('veiculos').select('filial_id').eq('id', id).maybeSingle();
    filialId = data?.filial_id ?? null;
    if (!filialId) return fail('Veículo não encontrado.');
  } else {
    filialId = resolveFilialId(session, requestedFilial);
    if (!filialId) return fail('Selecione a filial.', { filial_id: ['Selecione a filial.'] });
  }

  if (!pathBelongsTo(documento_path, filialId) || !pathBelongsTo(foto_geral_path, filialId)) {
    return fail('Arquivo enviado para uma filial inválida. Reenvie o arquivo.');
  }

  const base = {
    placa: v.placa,
    marca: v.marca ?? null,
    modelo: v.modelo ?? null,
    ano: v.ano ?? null,
    km_atual: v.km_atual,
    intervalo_revisao_km: v.intervalo_revisao_km,
    intervalo_revisao_dias: v.intervalo_revisao_dias,
    documento_url: documento_path ?? null,
    foto_geral_url: foto_geral_path ?? null,
    // FK composta (motorista_id, filial_id): o banco recusa motorista de outra filial
    motorista_id: v.motorista_id ?? null,
  };

  if (id) {
    const { error } = await session.supabase
      .from('veiculos')
      .update({
        ...base,
        proxima_revisao_km: v.proxima_revisao_km ?? null,
        proxima_revisao_data: v.proxima_revisao_data ?? null,
      })
      .eq('id', id);
    if (error) return fail(error.code === '23503' ? MOTORISTA_INVALIDO : friendlyDbError(error));
    await sincronizarAlertas(session.supabase, { veiculoId: id }).catch(() => undefined);
    revalidatePath('/veiculos');
    revalidatePath(`/veiculos/${id}`);
    redirect(`/veiculos/${id}`);
  }

  // Novo veículo: sem plano informado, o 1º vencimento parte do KM/data de hoje + intervalos.
  const { data: created, error } = await session.supabase
    .from('veiculos')
    .insert({
      ...base,
      filial_id: filialId,
      proxima_revisao_km: v.proxima_revisao_km ?? v.km_atual + v.intervalo_revisao_km,
      proxima_revisao_data: v.proxima_revisao_data ?? addDays(toISODate(), v.intervalo_revisao_dias),
    })
    .select('id')
    .single();
  if (error) return fail(error.code === '23503' ? MOTORISTA_INVALIDO : friendlyDbError(error));

  revalidatePath('/veiculos');
  redirect(`/veiculos/${created.id}`);
}

export async function excluirVeiculo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const { error, count } = await supabase.from('veiculos').delete({ count: 'exact' }).eq('id', id);
  if (error) {
    return fail(
      error.code === '23503'
        ? 'O veículo possui checklists ou manutenções no histórico e não pode ser excluído.'
        : friendlyDbError(error),
    );
  }
  if (!count) return fail('Veículo não encontrado.');
  revalidatePath('/veiculos');
  return ok('Veículo excluído.');
}

/**
 * Liberação do veículo bloqueado por avaria crítica, pelo responsável (supervisor da filial
 * ou admin), com o motivo. O conserto continua pendente na manutenção aberta.
 */
export async function liberarVeiculo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireSession();
  const parsed = liberarVeiculoSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Informe o motivo da liberação.', flattenErrors(parsed.error));

  const { error } = await supabase.rpc('liberar_veiculo', { p_veiculo_id: parsed.data.veiculo_id, p_motivo: parsed.data.motivo });
  if (error) return fail(friendlyDbError(error));

  revalidatePath('/dashboard');
  revalidatePath('/veiculos');
  revalidatePath(`/veiculos/${parsed.data.veiculo_id}`);
  revalidatePath('/meu-veiculo');
  return ok('Veículo liberado. O conserto continua pendente em Manutenções.');
}

/**
 * Decisão do supervisor (ou admin) para o veículo SEM checklist diário hoje: liberado ou não
 * para uso. "Não liberado" vale até o veículo fazer o checklist do dia. Pode mudar no mesmo dia.
 */
export async function decidirLiberacaoDiaria(dados: { veiculoId: string; liberado: boolean; observacao?: string }): Promise<ActionState> {
  const { supabase } = await requireSession();
  const parsed = decisaoDiariaSchema.safeParse(dados);
  if (!parsed.success) return fail('Decisão inválida. Atualize a página e tente de novo.');
  const { veiculoId, liberado, observacao } = parsed.data;
  const { error } = await supabase.rpc('decidir_liberacao_diaria', {
    p_veiculo_id: veiculoId,
    p_liberado: liberado,
    p_observacao: observacao || null,
  });
  if (error) return fail(friendlyDbError(error));
  revalidatePath('/checklists/hoje');
  revalidatePath('/dashboard');
  revalidatePath('/veiculos');
  revalidatePath(`/veiculos/${veiculoId}`);
  revalidatePath('/meu-veiculo');
  return ok(liberado ? 'Veículo liberado para uso hoje.' : 'Veículo não liberado até fazer o checklist do dia.');
}
