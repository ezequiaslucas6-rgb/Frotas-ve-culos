import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { PAGE_SIZE, type SearchParams } from '@/lib/pagination';
import { cn } from '@/lib/utils';

export function Pagination({
  basePath,
  searchParams,
  page,
  total,
  pageSize = PAGE_SIZE,
}: {
  basePath: string;
  searchParams: SearchParams;
  page: number;
  total: number;
  pageSize?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      const value = Array.isArray(v) ? v[0] : v;
      if (value && k !== 'page') params.set(k, value);
    }
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const base = buttonVariants({ variant: 'outline', size: 'sm' });
  return (
    <nav className="flex items-center justify-between gap-2 pt-2" aria-label="Paginação">
      <Link href={href(page - 1)} aria-disabled={page <= 1} className={cn(base, page <= 1 && 'pointer-events-none opacity-50')}>
        <ChevronLeft /> Anterior
      </Link>
      <span className="text-sm text-muted-foreground">
        Página {page} de {pages} · {total} registros
      </span>
      <Link href={href(page + 1)} aria-disabled={page >= pages} className={cn(base, page >= pages && 'pointer-events-none opacity-50')}>
        Próxima <ChevronRight />
      </Link>
    </nav>
  );
}
