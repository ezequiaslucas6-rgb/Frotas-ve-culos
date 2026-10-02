import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { HEADER_EMAIL, HEADER_UID } from '@/lib/supabase/session';
import type { Tables } from '@/types/database';

export type Profile = Tables<'profiles'> & {
  filiais: Pick<Tables<'filiais'>, 'id' | 'nome_cidade' | 'uf'> | null;
};

/** Usuário com o login verificado (JWT validado pelo proxy ou aqui). */
export interface UsuarioVerificado {
  id: string;
  email: string | null;
}

export interface Session {
  user: UsuarioVerificado;
  profile: Profile;
  isAdmin: boolean;
  /** Motorista: enxerga só o próprio cadastro, os veículos sob sua responsabilidade e os próprios abastecimentos. */
  isMotorista: boolean;
}

export const PAPEL_LABEL = {
  admin: 'Administrador Geral',
  supervisor: 'Supervisor',
  motorista: 'Motorista',
} as const;

/** Página inicial de cada papel. */
export const homeDoPapel = (role: Profile['role']) => (role === 'motorista' ? '/meu-veiculo' : '/dashboard');

/**
 * Quem está logado. O proxy já validou o JWT nesta requisição e repassou o usuário
 * por cabeçalho; só sem ele (ex.: logo após o login, na mesma Server Action) a
 * validação é feita aqui.
 */
const getUsuario = cache(async (): Promise<UsuarioVerificado | null> => {
  const h = await headers();
  const uid = h.get(HEADER_UID);
  if (uid) return { id: uid, email: decodeURIComponent(h.get(HEADER_EMAIL) ?? '') || null };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
});

/*
 * Perfil em memória por 60 s: a navegação entre telas não consulta o banco toda vez
 * só para saber nome/papel/filial. A consulta continua sob a RLS do próprio usuário;
 * quem altera um perfil chama esquecerPerfil(). (Papel e filial só mudam pelo admin,
 * e os DADOS são sempre filtrados pela RLS em tempo real.)
 */
const PERFIL_TTL_MS = 60_000;
const perfis = new Map<string, { perfil: Profile; expira: number }>();

export function esquecerPerfil(userId: string | null | undefined) {
  if (userId) perfis.delete(userId);
}

async function carregarPerfil(userId: string): Promise<Profile | null> {
  const agora = Date.now();
  const emCache = perfis.get(userId);
  if (emCache && emCache.expira > agora) return emCache.perfil;

  const supabase = await createClient();
  const { data: perfil } = await supabase
    .from('profiles')
    .select('*, filiais(id, nome_cidade, uf)')
    .eq('id', userId)
    .maybeSingle();
  if (!perfil) {
    perfis.delete(userId);
    return null;
  }
  if (perfis.size > 2000) for (const [id, p] of perfis) if (p.expira <= agora) perfis.delete(id);
  perfis.set(userId, { perfil, expira: agora + PERFIL_TTL_MS });
  return perfil;
}

/** Usuário autenticado + perfil (role/filial). Memoizado por requisição. */
export const getSession = cache(async (): Promise<Session | null> => {
  const user = await getUsuario();
  if (!user) return null;
  const profile = await carregarPerfil(user.id);
  if (!profile) return null;
  return { user, profile, isAdmin: profile.role === 'admin', isMotorista: profile.role === 'motorista' };
});

/**
 * Garante usuário logado COM perfil.
 *  - sem sessão                      -> /login
 *  - sessão sem registro em profiles -> /sem-acesso (evita loop de redirecionamento)
 *  - motorista                       -> /meu-veiculo, salvo nas telas que o admitem (`motorista: true`)
 *
 * Seguro por padrão: toda página/action da gestão que já chama requireSession()
 * continua fechada para o motorista sem precisar mudar nada.
 */
export async function requireSession(
  opts: { motorista?: boolean } = {},
): Promise<Session & { supabase: Awaited<ReturnType<typeof createClient>> }> {
  const session = await getSession();
  const supabase = await createClient();
  if (!session) redirect((await getUsuario()) ? '/sem-acesso' : '/login');
  if (session.isMotorista && !opts.motorista) redirect('/meu-veiculo');
  return { ...session, supabase };
}

/** Garante o Administrador Geral. Supervisores são redirecionados ao painel. */
export async function requireAdmin() {
  const session = await requireSession();
  if (!session.isAdmin) redirect('/dashboard?erro=acesso-negado');
  return session;
}

/** Telas exclusivas do motorista (ex.: Meu veículo). */
export async function requireMotorista() {
  const session = await requireSession({ motorista: true });
  if (!session.isMotorista) redirect('/dashboard');
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
