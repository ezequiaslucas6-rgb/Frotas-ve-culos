import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/session';

/**
 * Next.js 16: o antigo "middleware" agora se chama "proxy".
 * (Em Next 14/15 renomeie este arquivo para middleware.ts e a função para `middleware`.)
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // ignora estáticos, imagens, ícones/manifest e o cron (que autentica por Bearer próprio)
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
