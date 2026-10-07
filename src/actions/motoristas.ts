'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { esquecerPerfil, requireAdmin, requireSession, resolveFilialId } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { dadosPessoaisObrigatorios } from '@/lib/motoristas/obrigatorios';
import { acessoMotoristaSchema, flattenErrors, formDataToObject, motoristaSchemaPara } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';

/** Imagens da CNH vivem em <filial_id>/... no bucket "motoristas". */
const pathBelongsTo = (path: string | undefined, filialId: string) => !path || path.startsWith(`${filialId}/`);

export async function salvarMotorista(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const parsed = motoristaSchemaPara(dadosPessoaisObrigatorios()).safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));

  const { id, filial_id: requestedFilial, cnh_frente_path, cnh_verso_path, ...dados } = parsed.data;
  const values = {
    ...dados,
    // opcionais na fase de testes (ver lib/motoristas/obrigatorios): vazio grava null
    cpf: dados.cpf ?? null,
    whatsapp: dados.whatsapp ?? null,
    cnh: dados.cnh ?? null,
    cnh_categoria: dados.cnh_categoria ?? null,
    cnh_validade: dados.cnh_validade ?? null,
    cnh_primeira_habilitacao: dados.cnh_primeira_habilitacao ?? null,
    cnh_emissao: dados.cnh_emissao ?? null,
    cnh_uf: dados.cnh_uf ?? null,
    cnh_observacoes: dados.cnh_observacoes ?? null,
    cnh_frente_url: cnh_frente_path ?? null,
    cnh_verso_url: cnh_verso_path ?? null,
  };

  if (id) {
    // edição: a filial nunca é alterada (e a RLS barra qualquer acesso a outra filial)
    const { data: atual } = await session.supabase
      .from('motoristas')
      .select('filial_id, email, user_id')
      .eq('id', id)
      .maybeSingle();
    if (!atual) return fail('Motorista não encontrado.');
    if (!pathBelongsTo(cnh_frente_path, atual.filial_id) || !pathBelongsTo(cnh_verso_path, atual.filial_id)) {
      return fail('Arquivo enviado para uma filial inválida. Reenvie a imagem da CNH.');
    }

    // o login do motorista é o e-mail do cadastro: mantém os dois iguais
    if (atual.user_id && values.email !== atual.email) {
      const { error } = await createAdminClient().auth.admin.updateUserById(atual.user_id, {
        email: values.email,
        email_confirm: true,
      });
      if (error) return fail('Este e-mail já é usado por outro login.', { email: ['E-mail já usado por outro login.'] });
    }

    const { error } = await session.supabase.from('motoristas').update(values).eq('id', id);
    if (error) return fail(friendlyDbError(error));
    esquecerPerfil(atual.user_id); // o nome do login acompanha o cadastro
    revalidatePath('/motoristas');
    redirect(`/motoristas/${id}`);
  }

  const filialId = resolveFilialId(session, requestedFilial);
  if (!filialId) return fail('Selecione a filial.', { filial_id: ['Selecione a filial.'] });
  if (!pathBelongsTo(cnh_frente_path, filialId) || !pathBelongsTo(cnh_verso_path, filialId)) {
    return fail('Arquivo enviado para uma filial inválida. Reenvie a imagem da CNH.');
  }
  const { data: criado, error } = await session.supabase
    .from('motoristas')
    .insert({ ...values, filial_id: filialId })
    .select('id')
    .single();
  if (error) return fail(friendlyDbError(error));

  revalidatePath('/motoristas');
  redirect(`/motoristas/${criado.id}`);
}

export async function excluirMotorista(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const { data: alvo } = await supabase.from('motoristas').select('user_id').eq('id', id).maybeSingle();
  const { error, count } = await supabase.from('motoristas').delete({ count: 'exact' }).eq('id', id);
  if (error) {
    return fail(
      error.code === '23503'
        ? 'O motorista possui checklists ou abastecimentos no histórico. Para desligá-lo, altere o status para "Inativo".'
        : friendlyDbError(error),
    );
  }
  if (!count) return fail('Motorista não encontrado.');
  // sem o cadastro, o login não serve para nada: remove também
  if (alvo?.user_id) {
    try {
      await createAdminClient().auth.admin.deleteUser(alvo.user_id);
      esquecerPerfil(alvo.user_id);
    } catch {
      /* o login sem cadastro não enxerga nada (RLS); pode ser removido depois */
    }
  }
  revalidatePath('/motoristas');
  return ok('Motorista excluído.');
}

/* ----------------------------------------------------------------------------- *
 * Acesso do motorista ao app.
 * O cadastro é lido COM a sessão de quem pede (a RLS garante que o supervisor só
 * alcança motoristas da própria filial); só depois a service role cria/altera o login.
 * ----------------------------------------------------------------------------- */

async function motoristaDoChamador(id: string) {
  const session = await requireSession(); // admin ou supervisor (motorista é redirecionado)
  const { data } = await session.supabase
    .from('motoristas')
    .select('id, nome, email, filial_id, status, user_id')
    .eq('id', id)
    .maybeSingle();
  return data;
}

/** Garante que o login vinculado é mesmo de um motorista (nunca de um supervisor/admin). */
async function loginDeMotorista(userId: string) {
  const { data } = await createAdminClient().from('profiles').select('role').eq('id', userId).maybeSingle();
  return data?.role === 'motorista';
}

export async function criarAcessoMotorista(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = acessoMotoristaSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const m = await motoristaDoChamador(parsed.data.motorista_id);
  if (!m) return fail('Motorista não encontrado.');
  if (m.user_id) return fail('Este motorista já tem acesso ao app.');
  if (m.status === 'inativo') return fail('Reative o motorista antes de liberar o acesso.');

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: m.email,
    password: parsed.data.senha,
    email_confirm: true,
    user_metadata: { nome: m.nome },
  });
  if (authError || !created.user) {
    const duplicado = authError?.status === 422 || /already|registered/i.test(authError?.message ?? '');
    return fail(
      duplicado
        ? `O e-mail ${m.email} já é usado por outro login. Altere o e-mail do cadastro e tente de novo.`
        : 'Não foi possível criar o acesso.',
    );
  }

  const userId = created.user.id;
  const { error: perfilError } = await admin
    .from('profiles')
    .insert({ id: userId, nome: m.nome, role: 'motorista', filial_id: m.filial_id });
  const { error: vinculoError } = perfilError
    ? { error: perfilError }
    : await admin.from('motoristas').update({ user_id: userId }).eq('id', m.id).is('user_id', null);
  if (perfilError || vinculoError) {
    await admin.auth.admin.deleteUser(userId); // desfaz (o perfil cai em cascata)
    return fail(friendlyDbError((perfilError ?? vinculoError)!));
  }

  revalidatePath(`/motoristas/${m.id}`);
  revalidatePath('/motoristas');
  return ok(`Acesso liberado. Login: ${m.email} — repasse a senha provisória ao motorista.`);
}

export async function redefinirSenhaMotorista(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = acessoMotoristaSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Corrija os campos destacados.', flattenErrors(parsed.error));
  const m = await motoristaDoChamador(parsed.data.motorista_id);
  if (!m?.user_id || !(await loginDeMotorista(m.user_id))) return fail('Este motorista ainda não tem acesso ao app.');

  const { error } = await createAdminClient().auth.admin.updateUserById(m.user_id, { password: parsed.data.senha });
  if (error) return fail('Não foi possível redefinir a senha.');
  return ok('Senha redefinida. Repasse a nova senha ao motorista.');
}

export async function removerAcessoMotorista(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const m = await motoristaDoChamador(String(formData.get('id') ?? ''));
  if (!m?.user_id || !(await loginDeMotorista(m.user_id))) return fail('Este motorista não tem acesso ao app.');

  // apaga o login: o perfil cai em cascata e o cadastro é desvinculado (histórico preservado)
  const { error } = await createAdminClient().auth.admin.deleteUser(m.user_id);
  if (error) return fail('Não foi possível remover o acesso.');
  esquecerPerfil(m.user_id);
  revalidatePath(`/motoristas/${m.id}`);
  revalidatePath('/motoristas');
  return ok('Acesso removido.');
}
