import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';
import { getSupabasePublicEnv } from './env';

/** Rotas acessíveis sem login. */
const PUBLIC_PATHS = ['/login'];
/** Rotas exclusivas do Administrador Geral (validadas aqui E nas páginas/actions). */
const ADMIN_PATHS = ['/filiais', '/supervisores'];

const matches = (pathname: string, bases: string[]) =>
  bases.some((base) => pathname === base || pathname.startsWith(`${base}/`));

/**
 * Renova a sessão do Supabase e aplica o controle de acesso por rota:
 *  - sem sessão válida  -> /login?next=<rota>
 *  - logado em /login   -> /dashboard
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

  if (matches(pathname, PUBLIC_PATHS)) return redirectTo('/dashboard');

  if (matches(pathname, ADMIN_PATHS)) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') return redirectTo('/dashboard', { erro: 'acesso-negado' });
  }

  return response;
}
