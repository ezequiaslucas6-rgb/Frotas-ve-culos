import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardCheck, ListChecks, Plus } from 'lucide-react';
import { FilialFilter } from '@/components/filial-filter';
import { FormFiltros, LinkNavegacao } from '@/components/navegacao';
import { Pagination } from '@/components/pagination';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { ChecklistStatusBadge, ChecklistTipoBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { TIPOS_CHECKLIST, type ChecklistTipo } from '@/lib/checklist/etapas';
import { formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { pageRange, parsePage, resolveFilialFilter, type SearchParams } from '@/lib/pagination';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Checklists' };

const STATUS = ['ok', 'atencao', 'critico'] as const;

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // motorista: a RLS só devolve os checklists feitos em seu nome
  const session = await requireSession({ motorista: true });
  const { supabase, isAdmin } = session;
  const filialId = resolveFilialFilter(session, sp);
  const statusRaw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = STATUS.find((s) => s === statusRaw) ?? null;
  const tipoRaw = Array.isArray(sp.tipo) ? sp.tipo[0] : sp.tipo;
  const tipo = TIPOS_CHECKLIST.find((t) => t.value === tipoRaw)?.value ?? null;
  const page = parsePage(sp.page);
  const { from, to } = pageRange(page);

  let query = supabase
    .from('checklists')
    .select('id, data_envio, tipo, status, km_registro, veiculo_id, veiculos(placa, modelo), motoristas(nome), filiais(nome_cidade, uf)', { count: 'exact' })
    .order('data_envio', { ascending: false })
    .range(from, to);
  if (filialId) query = query.eq('filial_id', filialId);
  if (status) query = query.eq('status', status);
  if (tipo) query = query.eq('tipo', tipo);

  const [{ data: checklists, count }, { data: filiais }] = await Promise.all([
    query,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);

  // abas por tipo: mantêm os outros filtros e voltam para a primeira página
  const hrefTipo = (t: ChecklistTipo | null) => {
    const params = new URLSearchParams();
    if (t) params.set('tipo', t);
    if (status) params.set('status', status);
    if (filialId && isAdmin) params.set('filial', filialId);
    return params.size ? `/checklists?${params}` : '/checklists';
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Checklists"
        description={`${count ?? 0} checklist(s) enviado(s)`}
        actions={
          <>
            {isAdmin ? (
              <Link href="/checklists/modelos" className={buttonVariants({ variant: 'outline' })}>
                <ListChecks /> Modelos
              </Link>
            ) : null}
            <Link href={tipo ? `/checklists/novo?tipo=${tipo}` : '/checklists/novo'} className={buttonVariants()}>
              <Plus /> Novo checklist
            </Link>
          </>
        }
      />

      <nav aria-label="Tipo de checklist" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {[{ value: null, label: 'Todos' } as const, ...TIPOS_CHECKLIST].map((t) => (
          <LinkNavegacao
            key={t.label}
            href={hrefTipo(t.value)}
            aria-current={tipo === t.value ? 'page' : undefined}
            className="shrink-0 rounded-full border bg-card px-4 py-1.5 text-sm font-medium transition-colors hover:bg-raised aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
          >
            {t.label}
          </LinkNavegacao>
        ))}
      </nav>

      <FormFiltros className="flex flex-col gap-2 sm:flex-row">
        {filialId && isAdmin ? <input type="hidden" name="filial" value={filialId} /> : null}
        {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
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
      </FormFiltros>

      {(checklists ?? []).length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="Nenhum checklist encontrado"
          description="Inicie um checklist diário, semanal ou mensal para registrar as fotos do veículo."
          action={
            <Link href="/checklists/novo" className={buttonVariants()}>
              <Plus /> Novo checklist
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
          {(checklists ?? []).map((c) => (
            <li key={c.id}>
              <Link href={`/checklists/${c.id}`} className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-raised/60">
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
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                  <ChecklistTipoBadge tipo={c.tipo} />
                  <ChecklistStatusBadge status={c.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination basePath="/checklists" searchParams={sp} page={page} total={count ?? 0} />
    </div>
  );
}
