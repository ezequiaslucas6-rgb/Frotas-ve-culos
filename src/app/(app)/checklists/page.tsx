import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardCheck, Plus } from 'lucide-react';
import { FilialFilter } from '@/components/filial-filter';
import { Pagination } from '@/components/pagination';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { ChecklistStatusBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { pageRange, parsePage, resolveFilialFilter, type SearchParams } from '@/lib/pagination';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Checklists' };

const STATUS = ['ok', 'atencao', 'critico'] as const;

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin } = session;
  const filialId = resolveFilialFilter(session, sp);
  const statusRaw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = STATUS.find((s) => s === statusRaw) ?? null;
  const page = parsePage(sp.page);
  const { from, to } = pageRange(page);

  let query = supabase
    .from('checklists')
    .select('id, data_envio, status, km_registro, veiculo_id, veiculos(placa, modelo), motoristas(nome), filiais(nome_cidade, uf)', { count: 'exact' })
    .order('data_envio', { ascending: false })
    .range(from, to);
  if (filialId) query = query.eq('filial_id', filialId);
  if (status) query = query.eq('status', status);

  const [{ data: checklists, count }, { data: filiais }] = await Promise.all([
    query,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Checklists"
        description={`${count ?? 0} checklist(s) enviado(s)`}
        actions={
          <Link href="/checklists/novo" className={buttonVariants()}>
            <Plus /> Novo checklist
          </Link>
        }
      />

      <form className="flex flex-col gap-2 sm:flex-row" role="search">
        {filialId && isAdmin ? <input type="hidden" name="filial" value={filialId} /> : null}
        <Select name="status" defaultValue={status ?? ''} aria-label="Status" className="sm:w-48">
          <option value="">Todos os status</option>
          <option value="ok">Conforme</option>
          <option value="atencao">Atenção</option>
          <option value="critico">Avaria</option>
        </Select>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
      </form>

      {(checklists ?? []).length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="Nenhum checklist encontrado"
          description="Inicie um checklist para registrar as 14 fotos obrigatórias do veículo."
          action={
            <Link href="/checklists/novo" className={buttonVariants()}>
              <Plus /> Novo checklist
            </Link>
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {(checklists ?? []).map((c) => (
            <li key={c.id}>
              <Link href={`/checklists/${c.id}`} className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/40">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {c.veiculos ? formatPlaca(c.veiculos.placa) : '—'}
                    {c.veiculos?.modelo ? <span className="font-normal text-muted-foreground"> · {c.veiculos.modelo}</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.motoristas?.nome ?? '—'} · {formatDateTime(c.data_envio)}
                    {c.km_registro != null ? ` · ${formatKm(c.km_registro)}` : ''}
                    {isAdmin && c.filiais ? ` · ${formatFilial(c.filiais)}` : ''}
                  </p>
                </div>
                <ChecklistStatusBadge status={c.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination basePath="/checklists" searchParams={sp} page={page} total={count ?? 0} />
    </div>
  );
}
