'use server';

import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { esquecerPerfil, requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { flattenErrors, formDataToObject, supervisorSchema } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Cria o usuário no Supabase Auth + o perfil de supervisor vinculado a UMA filial.
 * Requer a service role (somente servidor) — por isso valida requireAdmin() antes.
 */
export async function criarSupervisor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = supervisorSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const { nome, email, senha, filial_id } = parsed.data;

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome },
  });
  if (authError || !created.user) {
    const duplicado = authError?.status === 422 || /already|registered/i.test(authError?.message ?? '');
    return fail(duplicado ? 'Já existe um usuário com este e-mail.' : 'Não foi possível criar o usuário.');
  }

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: created.user.id, nome, role: 'supervisor', filial_id });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id); // rollback
    return fail(friendlyDbError(profileError));
  }

  revalidatePath('/supervisores');
  return ok(`Supervisor ${nome} criado. Repasse o e-mail e a senha provisória a ele.`);
}

export async function excluirSupervisor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (id === user.id) return fail('Você não pode excluir o próprio usuário.');

  const admin = createAdminClient();
  const { data: alvo } = await admin.from('profiles').select('role').eq('id', id).maybeSingle();
  if (alvo?.role !== 'supervisor') return fail('Supervisor não encontrado.');

  const { error } = await admin.auth.admin.deleteUser(id);
  esquecerPerfil(id);
  if (error) {
    return fail('Não foi possível excluir: o supervisor possui checklists registrados (histórico preservado).');
  }
  revalidatePath('/supervisores');
  return ok('Supervisor excluído.');
}
