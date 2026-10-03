import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Wrench } from 'lucide-react';
import { excluirManutencao } from '@/actions/manutencoes';
import { FilialFilter } from '@/components/filial-filter';
import { FormFiltros } from '@/components/navegacao';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { AlertaBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { formatBRL, formatDateISO, formatFilial, formatKm } from '@/lib/format';
import { pageRange, parsePage, resolveFilialFilter, type SearchParams } from '@/lib/pagination';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Manutenções' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Intervalo [início, fim) de um mês "YYYY-MM". */
function monthRange(mes: string | undefined): { from: string; to: string } | null {
  if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return null;
  const [y, m] = mes.split('-').map(Number) as [number, number];
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from: `${mes}-01`, to };
}

export default async function ManutencoesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin } = session;
  const filialId = resolveFilialFilter(session, sp);
  const tipo = first(sp.tipo) === 'preventiva' || first(sp.tipo) === 'corretiva' ? (first(sp.tipo) as 'preventiva' | 'corretiva') : null;
  const mes = first(sp.mes);
  const periodo = monthRange(mes);
  const page = parsePage(sp.page);
  const { from, to } = pageRange(page);

  const aplicar = <T extends { eq: (c: string, v: string) => T; gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(q: T): T => {
    if (filialId) q = q.eq('filial_id', filialId);
    if (tipo) q = q.eq('tipo', tipo);
    if (periodo) q = q.gte('data_manutencao', periodo.from).lt('data_manutencao', periodo.to);
    return q;
  };

  const [{ data: manutencoes, count }, { data: totais }, { data: filiais }] = await Promise.all([
    aplicar(
      supabase
        .from('manutencoes')
        .select('*, veiculos(placa, modelo), filiais(nome_cidade, uf)', { count: 'exact' })
        .order('data_manutencao', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to),
    ),
    aplicar(supabase.from('manutencoes').select('custo, tipo')),
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);

  const custoTotal = (totais ?? []).reduce((acc, m) => acc + Number(m.custo), 0);
  const custoPreventiva = (totais ?? []).filter((m) => m.tipo === 'preventiva').reduce((acc, m) => acc + Number(m.custo), 0);
  const custoCorretiva = custoTotal - custoPreventiva;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Manutenções e custos"
        description={`${count ?? 0} lançamento(s)`}
        actions={
          <Link href="/manutencoes/nova" className={buttonVariants()}>
            <Plus /> Registrar manutenção
          </Link>
        }
      />

      <FormFiltros className="flex flex-col gap-2 sm:flex-row">
        {filialId && isAdmin ? <input type="hidden" name="filial" value={filialId} /> : null}
        <Select name="tipo" defaultValue={tipo ?? ''} aria-label="Tipo" className="sm:w-44">
          <option value="">Todos os tipos</option>
          <option value="preventiva">Preventivas</option>
          <option value="corretiva">Corretivas</option>
        </Select>
        <Input type="month" name="mes" defaultValue={mes ?? ''} aria-label="Mês" className="sm:w-44" />
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
      </FormFiltros>

      <section aria-label="Custos" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="gap-1 py-4">
          <CardContent>
            <p className="text-xs text-muted-foreground">Custo total</p>
            <p className="text-xl font-bold">{formatBRL(custoTotal)}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent>
            <p className="text-xs text-muted-foreground">Preventivas</p>
            <p className="text-xl font-bold">{formatBRL(custoPreventiva)}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent>
            <p className="text-xs text-muted-foreground">Corretivas</p>
            <p className="text-xl font-bold">{formatBRL(custoCorretiva)}</p>
          </CardContent>
        </Card>
      </section>

      {(manutencoes ?? []).length === 0 ? (
        <EmptyState icon={<Wrench />} title="Nenhuma manutenção encontrada" description="Registre revisões e reparos para acompanhar custos e alertas." />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
          {(manutencoes ?? []).map((m) => (
            <li key={m.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/veiculos/${m.veiculo_id}`} className="font-semibold hover:underline">
                    {m.veiculos ? formatPlaca(m.veiculos.placa) : '—'}
                  </Link>
                  <Badge variant={m.tipo === 'preventiva' ? 'secondary' : 'warning'}>{m.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}</Badge>
                  {m.status_alerta !== 'ok' ? <AlertaBadge nivel={m.status_alerta} /> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm">{m.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateISO(m.data_manutencao)} · {formatKm(m.km_registro)}
                  {m.fornecedor ? ` · ${m.fornecedor}` : ''}
                  {isAdmin && m.filiais ? ` · ${formatFilial(m.filiais)}` : ''}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="text-lg font-bold">{formatBRL(Number(m.custo))}</span>
                {isAdmin ? (
                  <DeleteButton action={excluirManutencao} id={m.id} confirmMessage="Excluir este lançamento de manutenção?" />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination basePath="/manutencoes" searchParams={sp} page={page} total={count ?? 0} />
    </div>
  );
}
