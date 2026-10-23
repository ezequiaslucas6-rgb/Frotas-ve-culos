'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin, requireSession } from '@/lib/auth';
import { arred2, registroLeituraSchema } from '@/lib/abastecimento/cupom';
import { kmAbaixoDaReferencia, referenciaDoKm, type UltimoAbastecimento } from '@/lib/abastecimento/referencia';
import { toISODate } from '@/lib/dates';
import { friendlyDbError } from '@/lib/db-errors';
import { formatDateISO, formatKm } from '@/lib/format';
import { sincronizarAlertas } from '@/lib/maintenance/sync';
import { abastecimentoSchema, flattenErrors, formDataToObject } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Enums } from '@/types/database';

/**
 * Último abastecimento do veículo (data e KM), de TODOS os motoristas: o motorista só enxerga os
 * próprios lançamentos, mas a referência do hodômetro é a do veículo. `ate`: só até esta data.
 * Lido com o cliente do servidor (só o KM e a data, de um veículo que o chamador já enxerga).
 */
async function ultimoAbastecimentoDe(veiculoId: string, ate?: string): Promise<UltimoAbastecimento | null> {
  let consulta = createAdminClient().from('abastecimentos').select('km, data_abastecimento').eq('veiculo_id', veiculoId);
  if (ate) consulta = consulta.lte('data_abastecimento', ate);
  const { data } = await consulta
    .order('data_abastecimento', { ascending: false })
    .order('km', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { km: data.km, data: data.data_abastecimento } : null;
}

/** Para o formulário: o último abastecimento do veículo escolhido (referência do KM). */
export async function ultimoAbastecimentoDoVeiculo(veiculoId: string): Promise<{ ok: boolean; ultimo: UltimoAbastecimento | null }> {
  const session = await requireSession({ motorista: true });
  if (!/^[0-9a-f-]{36}$/i.test(veiculoId)) return { ok: false, ultimo: null };
  // a RLS decide se este veículo é visível para quem pergunta
  const { data: veiculo } = await session.supabase.from('veiculos').select('id').eq('id', veiculoId).maybeSingle();
  if (!veiculo) return { ok: false, ultimo: null };
  return { ok: true, ultimo: await ultimoAbastecimentoDe(veiculoId) };
}

/**
 * Lançamento de abastecimento. Pode vir do próprio motorista (só nos veículos em que é
 * o responsável) ou do supervisor/admin. A RLS valida tudo de novo no banco; o KM do
 * veículo é atualizado por gatilho (nunca regride).
 */
export async function registrarAbastecimento(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession({ motorista: true });
  const parsed = abastecimentoSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const { veiculo_id, motorista_id: motoristaEscolhido, comprovante_path, leitura_cupom, ...a } = parsed.data;

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

  // O hodômetro é conferido com o ÚLTIMO ABASTECIMENTO do veículo (não com o KM do veículo, que também
  // sobe com checklists). Menor só é aceito em lançamento retroativo (dia anterior).
  const ultimo = await ultimoAbastecimentoDe(veiculo.id, a.data_abastecimento);
  const referencia = referenciaDoKm(ultimo, veiculo.km_atual);
  if (kmAbaixoDaReferencia(a.km, a.data_abastecimento, toISODate(), referencia)) {
    return fail('Confira o hodômetro.', {
      km: [
        referencia.origem === 'abastecimento'
          ? `O KM é menor que o do último abastecimento (${formatKm(referencia.km)}, em ${formatDateISO(referencia.data)}).`
          : `O KM é menor que o último registrado para o veículo (${formatKm(referencia.km)}).`,
      ],
    });
  }
  if (comprovante_path && !comprovante_path.startsWith(`${veiculo.filial_id}/${veiculo.id}/`)) {
    return fail('Comprovante enviado para a pasta errada. Envie a foto novamente.');
  }

  // o que a leitura da foto encontrou fica junto, só para conferência (se vier algo estranho, é ignorado)
  let leitura: ReturnType<typeof registroLeituraSchema.parse> | null = null;
  try {
    const r = leitura_cupom ? registroLeituraSchema.safeParse(JSON.parse(leitura_cupom)) : null;
    leitura = r?.success ? r.data : null;
  } catch {
    leitura = null;
  }

  const { error } = await session.supabase.from('abastecimentos').insert({
    veiculo_id: veiculo.id,
    filial_id: veiculo.filial_id,
    motorista_id: motoristaId,
    data_abastecimento: a.data_abastecimento,
    km: a.km,
    litros: a.litros,
    // valor líquido: o que foi pago (o preço por litro gravado já sai com desconto)
    valor_bruto: a.valor_bruto,
    desconto: a.desconto,
    valor_total: arred2(a.valor_bruto - a.desconto),
    leitura_cupom: leitura,
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
