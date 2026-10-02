import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/types/database';

export type Profile = Tables<'profiles'> & {
  filiais: Pick<Tables<'filiais'>, 'id' | 'nome_cidade' | 'uf'> | null;
};

export interface Session {
  user: User;
  profile: Profile;
  isAdmin: boolean;
}

/** Usuário autenticado + perfil (role/filial). Memoizado por requisição. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, filiais(id, nome_cidade, uf)')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return null;

  return { user, profile, isAdmin: profile.role === 'admin' };
});

/**
 * Garante usuário logado COM perfil.
 *  - sem sessão                -> /login
 *  - sessão sem registro em profiles -> /sem-acesso (evita loop de redirecionamento)
 */
export async function requireSession(): Promise<Session & { supabase: Awaited<ReturnType<typeof createClient>> }> {
  const session = await getSession();
  const supabase = await createClient();
  if (!session) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    redirect(user ? '/sem-acesso' : '/login');
  }
  return { ...session, supabase };
}

/** Garante o Administrador Geral. Supervisores são redirecionados ao painel. */
export async function requireAdmin() {
  const session = await requireSession();
  if (!session.isAdmin) redirect('/dashboard?erro=acesso-negado');
  return session;
}

/**
 * Resolve a filial-alvo de uma escrita.
 * Supervisor: SEMPRE a própria filial (ignora o valor enviado pelo cliente).
 * Admin: a filial informada (obrigatória).
 */
export function resolveFilialId(session: Session, requested?: string | null): string | null {
  if (!session.isAdmin) return session.profile.filial_id;
  return requested || null;
}
