'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin, requireSession, resolveFilialId } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { flattenErrors, formDataToObject, motoristaSchema } from '@/lib/schemas';

export async function salvarMotorista(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const parsed = motoristaSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));

  const { id, filial_id: requestedFilial, ...values } = parsed.data;

  if (id) {
    // edição: a filial nunca é alterada (e a RLS barra qualquer acesso a outra filial)
    const { error } = await session.supabase.from('motoristas').update(values).eq('id', id);
    if (error) return fail(friendlyDbError(error));
  } else {
    const filialId = resolveFilialId(session, requestedFilial);
    if (!filialId) return fail('Selecione a filial.', { filial_id: ['Selecione a filial.'] });
    const { error } = await session.supabase.from('motoristas').insert({ ...values, filial_id: filialId });
    if (error) return fail(friendlyDbError(error));
  }

  revalidatePath('/motoristas');
  redirect('/motoristas');
}

export async function excluirMotorista(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const { error, count } = await supabase.from('motoristas').delete({ count: 'exact' }).eq('id', id);
  if (error) {
    return fail(
      error.code === '23503'
        ? 'O motorista possui checklists no histórico. Para desligá-lo, altere o status para "Inativo".'
        : friendlyDbError(error),
    );
  }
  if (!count) return fail('Motorista não encontrado.');
  revalidatePath('/motoristas');
  return ok('Motorista excluído.');
}
