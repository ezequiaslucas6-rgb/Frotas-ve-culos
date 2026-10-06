import { paraCsv } from '@/lib/abastecimento/acompanhamento';
import { carregarAcompanhamento, lerParametros } from '@/lib/abastecimento/acompanhamento-dados';
import { requireSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Planilha do acompanhamento (mesmos filtros da tela). Abre no Excel/Planilhas Google. */
export async function GET(request: Request) {
  const session = await requireSession();
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const p = lerParametros(sp, session);
  const { linhas } = await carregarAcompanhamento(session.supabase, p);
  return new Response(paraCsv(linhas), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="abastecimentos-${p.de}-a-${p.ate}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
