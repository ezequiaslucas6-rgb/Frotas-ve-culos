'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { filialSchema, flattenErrors, formDataToObject } from '@/lib/schemas';

export async function salvarFilial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const parsed = filialSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));

  const { id, ...values } = parsed.data;
  const { error } = id
    ? await supabase.from('filiais').update(values).eq('id', id)
    : await supabase.from('filiais').insert(values);
  if (error) return fail(friendlyDbError(error));

  revalidatePath('/filiais');
  if (id) redirect('/filiais');
  return ok('Filial cadastrada.');
}

export async function excluirFilial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const { error, count } = await supabase.from('filiais').delete({ count: 'exact' }).eq('id', id);
  if (error) {
    return fail(
      error.code === '23503'
        ? 'Não é possível excluir: a filial possui veículos, motoristas ou usuários vinculados.'
        : friendlyDbError(error),
    );
  }
  if (!count) return fail('Filial não encontrada.');
  revalidatePath('/filiais');
  return ok('Filial excluída.');
}
