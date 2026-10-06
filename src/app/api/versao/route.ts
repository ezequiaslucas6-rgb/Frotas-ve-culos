/**
 * Versão publicada no servidor. O app aberto compara com a dele e, se mudou, recarrega
 * (src/components/atualizacao-automatica.tsx). Pública e sem cache.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { versao: process.env.NEXT_PUBLIC_VERSAO_APP ?? 'dev' },
    { headers: { 'cache-control': 'no-store, max-age=0' } },
  );
}
