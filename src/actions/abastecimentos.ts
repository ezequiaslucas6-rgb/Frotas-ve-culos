'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin, requireSession } from '@/lib/auth';
import { toISODate } from '@/lib/dates';
import { friendlyDbError } from '@/lib/db-errors';
import { formatKm } from '@/lib/format';
import { sincronizarAlertas } from '@/lib/maintenance/sync';
import { abastecimentoSchema, flattenErrors, formDataToObject } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Enums } from '@/types/database';

/**
 * Lançamento de abastecimento. Pode vir do próprio motorista (só nos veículos em que é
 * o responsável) ou do supervisor/admin. A RLS valida tudo de novo no banco; o KM do
 * veículo é atualizado por gatilho (nunca regride).
 */
export async function registrarAbastecimento(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession({ motorista: true });
  const parsed = abastecimentoSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const { veiculo_id, motorista_id: motoristaEscolhido, comprovante_path, ...a } = parsed.data;

  // lido com a sessão: o motorista só enxerga os veículos dele; o supervisor, os da filial
  const { data: veiculo } = await session.supabase
    .from('veiculos')
    .select('id, filial_id, km_atual, motorista_id')
    .eq('id', veiculo_id)
    .maybeSingle();
  if (!veiculo) return fail('Veículo não encontrado.', { veiculo_id: ['Selecione um veículo válido.'] });

  let motoristaId: string | null;
  if (session.isMotorista) {
    const { data: eu } = await session.supabase.from('motoristas').select('id').eq('user_id', session.user.id).maybeSingle();
    if (!eu) return fail('Seu acesso de motorista está suspenso. Fale com o seu supervisor.');
    motoristaId = eu.id;
  } else {
    motoristaId = motoristaEscolhido ?? veiculo.motorista_id;
  }

  // Hodômetro menor que o do veículo só é aceito em lançamento retroativo (dia anterior).
  if (a.km < veiculo.km_atual && a.data_abastecimento >= toISODate()) {
    return fail('Confira o hodômetro.', {
      km: [`O KM é menor que o último registrado para o veículo (${formatKm(veiculo.km_atual)}).`],
    });
  }
  if (comprovante_path && !comprovante_path.startsWith(`${veiculo.filial_id}/${veiculo.id}/`)) {
    return fail('Comprovante enviado para a pasta errada. Envie a foto novamente.');
  }

  const { error } = await session.supabase.from('abastecimentos').insert({
    veiculo_id: veiculo.id,
    filial_id: veiculo.filial_id,
    motorista_id: motoristaId,
    data_abastecimento: a.data_abastecimento,
    km: a.km,
    litros: a.litros,
    valor_total: a.valor_total,
    combustivel: a.combustivel as Enums<'combustivel'>,
    tanque_cheio: a.tanque_cheio,
    posto: a.posto || null,
    observacao: a.observacao || null,
    comprovante_url: comprovante_path ?? null,
  });
  if (error) return fail(friendlyDbError(error));

  // O KM mudou: reavalia o alerta de revisão deste veículo (já validado pela RLS acima).
  // O motorista não grava manutenções, por isso a reavaliação usa o cliente do servidor.
  // Falhar aqui não desfaz o lançamento: o cron diário reavalia todos os veículos.
  try {
    const cliente = session.isMotorista ? createAdminClient() : session.supabase;
    await sincronizarAlertas(cliente, { veiculoId: veiculo.id });
  } catch {
    /* segue: o lançamento já foi gravado */
  }

  revalidatePath('/abastecimentos');
  revalidatePath('/meu-veiculo');
  revalidatePath(`/veiculos/${veiculo.id}`);
  redirect('/abastecimentos?registrado=1');
}

export async function excluirAbastecimento(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const { error, count } = await supabase.from('abastecimentos').delete({ count: 'exact' }).eq('id', id);
  if (error) return fail(friendlyDbError(error));
  if (!count) return fail('Lançamento não encontrado.');
  revalidatePath('/abastecimentos');
  return ok('Lançamento excluído.');
}
