import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';
import { getSupabasePublicEnv } from './env';

/** Rotas acessíveis sem login. */
const PUBLIC_PATHS = ['/login'];

/**
 * Usuário JÁ VERIFICADO pelo proxy, repassado às páginas e Server Actions da mesma
 * requisição (evita validar o login de novo em cada tela). O proxy sempre apaga o
 * que vier do navegador antes de gravar estes cabeçalhos, então não dá para forjá-los.
 */
export const HEADER_UID = 'x-frotas-uid';
export const HEADER_EMAIL = 'x-frotas-email';

const matches = (pathname: string, bases: string[]) =>
  bases.some((base) => pathname === base || pathname.startsWith(`${base}/`));

/**
 * Renova a sessão do Supabase e faz o portão de login:
 *  - sem sessão válida -> /login?next=<rota>
 *  - logado em /login  -> / (que leva à página inicial do papel)
 *
 * O login é validado com getClaims(): com as chaves de assinatura assimétricas do
 * Supabase a verificação é local (sem ida ao servidor do Auth); com a chave legada
 * ele consulta o Auth, como antes. A permissão por PAPEL (admin, supervisor,
 * motorista) é decidida em cada página/Server Action (requireSession, requireAdmin,
 * requireMotorista) e, para os dados, pela RLS do Postgres.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // nunca confie nestes cabeçalhos vindos de fora
  request.headers.delete(HEADER_UID);
  request.headers.delete(HEADER_EMAIL);

  let response = NextResponse.next({ request });
  let headersSupabase: Record<string, string> = {};
  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        headersSupabase = headers ?? {};
        Object.entries(headersSupabase).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Verifica a assinatura do JWT (e renova a sessão se o token expirou).
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = '';
    Object.entries(params ?? {}).forEach(([k, v]) => target.searchParams.set(k, v));
    const redirect = NextResponse.redirect(target);
    // preserva os cookies de sessão renovados
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    Object.entries(headersSupabase).forEach(([k, v]) => redirect.headers.set(k, v));
    return redirect;
  };

  if (!claims?.sub) {
    if (matches(pathname, PUBLIC_PATHS)) return response;
    return redirectTo('/login', pathname === '/' ? undefined : { next: `${pathname}${search}` });
  }

  if (matches(pathname, PUBLIC_PATHS)) return redirectTo('/');

  request.headers.set(HEADER_UID, claims.sub);
  request.headers.set(HEADER_EMAIL, encodeURIComponent(typeof claims.email === 'string' ? claims.email : ''));
  const final = NextResponse.next({ request });
  response.cookies.getAll().forEach((cookie) => final.cookies.set(cookie));
  Object.entries(headersSupabase).forEach(([k, v]) => final.headers.set(k, v));
  return final;
}
