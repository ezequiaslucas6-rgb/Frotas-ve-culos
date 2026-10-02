import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';
import { getSupabasePublicEnv } from './env';

/** Rotas acessíveis sem login. */
const PUBLIC_PATHS = ['/login'];
/** Rotas exclusivas do Administrador Geral (validadas aqui E nas páginas/actions). */
const ADMIN_PATHS = ['/filiais', '/supervisores'];
/** As ÚNICAS rotas que o motorista acessa (todo o resto o devolve ao "Meu veículo"). */
const MOTORISTA_PATHS = ['/meu-veiculo', '/abastecimentos', '/perfil', '/sem-acesso'];
/** Exclusivas do motorista. */
const SOMENTE_MOTORISTA_PATHS = ['/meu-veiculo'];

const matches = (pathname: string, bases: string[]) =>
  bases.some((base) => pathname === base || pathname.startsWith(`${base}/`));

/**
 * Renova a sessão do Supabase e aplica o controle de acesso por rota:
 *  - sem sessão válida  -> /login?next=<rota>
 *  - logado em /login   -> página inicial do papel
 *  - motorista          -> só MOTORISTA_PATHS
 *  - rota de admin      -> exige profiles.role = 'admin' (consulta com a RLS do usuário)
 *
 * Importante: a autorização REAL dos dados é a RLS do Postgres; este proxy é a
 * primeira camada (UX + defesa em profundidade), nunca a única.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() revalida o JWT no servidor do Auth (não confie apenas no cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = '';
    Object.entries(params ?? {}).forEach(([k, v]) => target.searchParams.set(k, v));
    const redirect = NextResponse.redirect(target);
    // preserva os cookies de sessão renovados
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!user) {
    if (matches(pathname, PUBLIC_PATHS)) return response;
    return redirectTo('/login', pathname === '/' ? undefined : { next: `${pathname}${search}` });
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = profile?.role;
  const home = role === 'motorista' ? '/meu-veiculo' : '/dashboard';

  if (matches(pathname, PUBLIC_PATHS)) return redirectTo(home);
  if (!role) return response; // sem perfil: as páginas levam a /sem-acesso

  if (role === 'motorista') {
    if (!matches(pathname, MOTORISTA_PATHS)) return redirectTo(home);
    return response;
  }
  if (matches(pathname, SOMENTE_MOTORISTA_PATHS)) return redirectTo(home);
  if (matches(pathname, ADMIN_PATHS) && role !== 'admin') return redirectTo(home, { erro: 'acesso-negado' });

  return response;
}
