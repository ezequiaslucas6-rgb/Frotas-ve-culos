import { chavePublicaVapid, fcmConfigurado } from '@/lib/push/enviar';

export const dynamic = 'force-dynamic';

/** Chave pública (VAPID) para o navegador assinar o push. Pública por natureza; o login é exigido pelo proxy. */
export async function GET() {
  return Response.json({ chave: chavePublicaVapid(), fcm: fcmConfigurado() }, { headers: { 'cache-control': 'no-store' } });
}
