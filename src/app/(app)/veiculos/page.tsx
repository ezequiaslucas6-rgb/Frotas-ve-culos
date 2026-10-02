import type { Metadata } from 'next';
import Link from 'next/link';
import { Gauge, Plus, Search, Truck, UserRound } from 'lucide-react';
import { FilialFilter } from '@/components/filial-filter';
import { FormFiltros } from '@/components/navegacao';
import { Pagination } from '@/components/pagination';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { AlertaBadge, SaudeBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { formatFilial, formatKm } from '@/lib/format';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import { descreverAlerta } from '@/lib/maintenance/describe';
import { PAGE_SIZE, pageRange, parsePage, resolveFilialFilter, sanitizeSearch, type SearchParams } from '@/lib/pagination';
import { signedThumbMap } from '@/lib/storage';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Veículos' };

export default async function VeiculosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin } = session;
  const filialId = resolveFilialFilter(session, sp);
  const q = sanitizeSearch(sp.q);
  const page = parsePage(sp.page);
  const { from, to } = pageRange(page);

  let query = supabase.from('vw_veiculos_painel').select('*', { count: 'exact' }).order('placa').range(from, to);
  if (filialId) query = query.eq('filial_id', filialId);
  if (q) query = query.or(`placa.ilike.%${q}%,modelo.ilike.%${q}%,marca.ilike.%${q}%`);

  const [{ data, count }, { data: filiais }] = await Promise.all([
    query,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);
  const veiculos = (data ?? []).map((v) => ({ ...v, ...avaliarVeiculoPainel(v) }));
  // miniaturas (poucos KB) em vez das fotos completas: a lista carrega bem mais rápido no celular
  const fotos = await signedThumbMap(supabase, 'veiculos', veiculos.map((v) => v.foto_geral_url));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Veículos"
        description={`${count ?? 0} veículo(s)`}
        actions={
          <Link href="/veiculos/novo" className={buttonVariants()}>
            <Plus /> Novo veículo
          </Link>
        }
      />

      <FormFiltros className="flex flex-col gap-2 sm:flex-row">
        {filialId && isAdmin ? <input type="hidden" name="filial" value={filialId} /> : null}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Buscar por placa, marca ou modelo" className="pl-9" aria-label="Buscar veículos" />
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
        {isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
      </FormFiltros>

      {veiculos.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title="Nenhum veículo encontrado"
          description={q ? 'Tente outro termo de busca.' : 'Cadastre o primeiro veículo para começar a registrar checklists.'}
          action={
            q ? undefined : (
              <Link href="/veiculos/novo" className={buttonVariants()}>
                <Plus /> Novo veículo
              </Link>
            )
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {veiculos.map((v) => (
            <li key={v.id}>
              <Link
                href={`/veiculos/${v.id}`}
                className="flex h-full gap-3 rounded-2xl bg-card p-3 transition-colors hover:bg-raised"
              >
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                  {v.foto_geral_url && fotos[v.foto_geral_url] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fotos[v.foto_geral_url]}
                      alt={`Foto do veículo ${v.placa}`}
                      loading="lazy"
                      decoding="async"
                      width={80}
                      height={80}
                      className="size-full object-cover"
                    />
                  ) : (
                    <Truck className="size-7" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold tracking-wide">{formatPlaca(v.placa)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[v.marca, v.modelo, v.ano].filter(Boolean).join(' ') || 'Sem modelo informado'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SaudeBadge saude={v.saude} />
                    {v.alerta.nivel !== 'ok' ? <AlertaBadge nivel={v.alerta.nivel} /> : null}
                  </div>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Gauge className="size-3.5" /> {formatKm(v.km_atual)}
                    {isAdmin ? ` · ${formatFilial(v)}` : ''}
                  </p>
                  {v.motorista_nome ? (
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <UserRound className="size-3.5 shrink-0" /> {v.motorista_nome}
                    </p>
                  ) : null}
                  {v.alerta.nivel !== 'ok' ? <p className="text-xs text-muted-foreground">{descreverAlerta(v.alerta)}</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination basePath="/veiculos" searchParams={sp} page={page} total={count ?? 0} pageSize={PAGE_SIZE} />
    </div>
  );
}
