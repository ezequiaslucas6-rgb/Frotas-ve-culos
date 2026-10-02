'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireSession } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { flattenErrors, formDataToObject, perfilSchema, trocarSenhaSchema } from '@/lib/schemas';
import { getSupabasePublicEnv } from '@/lib/supabase/env';
import type { Database } from '@/types/database';

/** Nome e foto do próprio usuário (o papel e a filial continuam só com o admin). */
export async function salvarPerfil(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession({ motorista: true });
  const parsed = perfilSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const { nome, avatar_path } = parsed.data;
  if (avatar_path && !avatar_path.startsWith(`${session.user.id}/`)) return fail('Envie a foto novamente.');

  const { error } = await session.supabase.rpc('atualizar_meu_perfil', {
    p_nome: session.isMotorista ? null : (nome ?? null),
    p_avatar_url: avatar_path ?? null,
  });
  if (error) return fail(friendlyDbError(error));

  revalidatePath('/', 'layout'); // nome e foto aparecem no cabeçalho de todas as telas
  return ok('Perfil atualizado.');
}

export async function trocarSenha(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession({ motorista: true });
  const parsed = trocarSenhaSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const email = session.user.email;
  if (!email) return fail('Usuário sem e-mail de login.');

  // Confirma a senha atual num cliente isolado (sem cookies): a sessão do navegador não muda.
  const { url, anonKey } = getSupabasePublicEnv();
  const verificador = createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: senhaErrada } = await verificador.auth.signInWithPassword({ email, password: parsed.data.senha_atual });
  if (senhaErrada) return fail('Senha atual incorreta.', { senha_atual: ['Senha atual incorreta.'] });
  await verificador.auth.signOut({ scope: 'local' }).catch(() => undefined);

  const { error } = await session.supabase.auth.updateUser({ password: parsed.data.nova_senha });
  if (error) return fail('Não foi possível alterar a senha. Tente outra senha.');
  return ok('Senha alterada. Use a nova senha no próximo login.');
}
