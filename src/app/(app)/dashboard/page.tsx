import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CircleCheck, ClipboardCheck, DollarSign, Plus, Truck, Wrench } from 'lucide-react';
import { AtualizarAlertasButton } from '@/components/atualizar-alertas-button';
import { FilialFilter } from '@/components/filial-filter';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { AlertaBadge, ChecklistStatusBadge, SaudeBadge } from '@/components/ui/status-badges';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';
import { toISODate } from '@/lib/dates';
import { formatBRL, formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import { descreverAlerta } from '@/lib/maintenance/describe';
import { resolveFilialFilter, type SearchParams } from '@/lib/pagination';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Painel' };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin, profile } = session;
  const filialId = resolveFilialFilter(session, sp);
  const hoje = toISODate();
  const inicioMes = `${hoje.slice(0, 8)}01`;

  let veiculosQ = supabase.from('vw_veiculos_painel').select('*').order('placa');
  let custosQ = supabase.from('manutencoes').select('custo, filial_id').gte('data_manutencao', inicioMes);
  let checklistsQ = supabase
    .from('checklists')
    .select('id, data_envio, status, veiculos(placa, modelo), motoristas(nome)')
    .order('data_envio', { ascending: false })
    .limit(6);
  if (filialId) {
    veiculosQ = veiculosQ.eq('filial_id', filialId);
    custosQ = custosQ.eq('filial_id', filialId);
    checklistsQ = checklistsQ.eq('filial_id', filialId);
  }

  const [{ data: veiculosRaw }, { data: custos }, { data: ultimosChecklists }, { data: filiais }] = await Promise.all([
    veiculosQ,
    custosQ,
    checklistsQ,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);

  const veiculos = (veiculosRaw ?? []).map((v) => ({ ...v, ...avaliarVeiculoPainel(v, hoje) }));
  const contagem = {
    liberado: veiculos.filter((v) => v.saude === 'liberado').length,
    atencao: veiculos.filter((v) => v.saude === 'atencao').length,
    manutencao: veiculos.filter((v) => v.saude === 'manutencao').length,
  };
  const custoMes = (custos ?? []).reduce((acc, m) => acc + Number(m.custo), 0);

  const requerAtencao = veiculos
    .filter((v) => v.saude !== 'liberado')
    .sort((a, b) => (a.saude === b.saude ? a.placa.localeCompare(b.placa) : a.saude === 'manutencao' ? -1 : 1));
  const alertasRevisao = veiculos
    .filter((v) => v.alerta.nivel !== 'ok')
    .sort((a, b) => (a.alerta.nivel === b.alerta.nivel ? 0 : a.alerta.nivel === 'vencido' ? -1 : 1));

  const escopo = filialId
    ? (filiais?.find((f) => f.id === filialId) ?? profile.filiais)
    : null;

  const porFilial = isAdmin && !filialId
    ? (filiais ?? []).map((f) => {
        const doFilial = veiculos.filter((v) => v.filial_id === f.id);
        const custo = (custos ?? []).filter((m) => m.filial_id === f.id).reduce((acc, m) => acc + Number(m.custo), 0);
        return {
          filial: f,
          total: doFilial.length,
          liberado: doFilial.filter((v) => v.saude === 'liberado').length,
          atencao: doFilial.filter((v) => v.saude === 'atencao').length,
          manutencao: doFilial.filter((v) => v.saude === 'manutencao').length,
          custo,
        };
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Painel da frota"
        description={escopo ? `Filial ${formatFilial(escopo)}` : 'Visão global de todas as filiais'}
        actions={
          <>
            {isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
            <AtualizarAlertasButton />
            <Link href="/checklists/novo" className={buttonVariants()}>
              <Plus /> Novo checklist
            </Link>
          </>
        }
      />

      {sp.erro === 'acesso-negado' ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          Você não tem permissão para acessar essa área.
        </p>
      ) : null}

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={<Truck />} label="Veículos" value={String(veiculos.length)} />
        <StatCard icon={<CircleCheck />} label="Liberados" value={String(contagem.liberado)} tone="success" />
        <StatCard icon={<AlertTriangle />} label="Atenção" value={String(contagem.atencao)} tone="warning" />
        <StatCard icon={<Wrench />} label="Manutenção/Avaria" value={String(contagem.manutencao)} tone="danger" />
        <StatCard
          icon={<DollarSign />}
          label="Custo no mês"
          value={formatBRL(custoMes)}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      {isAdmin && !filialId ? (
        <Card>
          <CardHeader>
            <CardTitle>Saúde da frota por filial</CardTitle>
          </CardHeader>
          <CardContent>
            {porFilial.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma filial cadastrada.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filial</TableHead>
                    <TableHead className="text-right">Veículos</TableHead>
                    <TableHead>Liberados</TableHead>
                    <TableHead>Atenção</TableHead>
                    <TableHead>Manutenção</TableHead>
                    <TableHead className="text-right">Custo no mês</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porFilial.map((r) => (
                    <TableRow key={r.filial.id}>
                      <TableCell className="font-medium">
                        <Link href={`/dashboard?filial=${r.filial.id}`} className="hover:underline">
                          {formatFilial(r.filial)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{r.total}</TableCell>
                      <TableCell><Badge variant="success">{r.liberado}</Badge></TableCell>
                      <TableCell><Badge variant="warning">{r.atencao}</Badge></TableCell>
                      <TableCell><Badge variant="danger">{r.manutencao}</Badge></TableCell>
                      <TableCell className="text-right">{formatBRL(r.custo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Requer atenção</CardTitle>
          </CardHeader>
          <CardContent>
            {requerAtencao.length === 0 ? (
              <EmptyState icon={<CircleCheck />} title="Toda a frota está liberada" />
            ) : (
              <ul className="divide-y">
                {requerAtencao.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={`/veiculos/${v.id}`} className="font-medium hover:underline">
                        {formatPlaca(v.placa)}
                        {v.modelo ? <span className="font-normal text-muted-foreground"> · {v.modelo}</span> : null}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {isAdmin ? `${formatFilial(v)} · ` : ''}
                        {v.motivos.join(' · ')}
                      </p>
                    </div>
                    <SaudeBadge saude={v.saude} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alertas de revisão preventiva</CardTitle>
          </CardHeader>
          <CardContent>
            {alertasRevisao.length === 0 ? (
              <EmptyState icon={<Wrench />} title="Nenhuma revisão próxima ou vencida" />
            ) : (
              <ul className="divide-y">
                {alertasRevisao.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={`/veiculos/${v.id}`} className="font-medium hover:underline">
                        {formatPlaca(v.placa)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {descreverAlerta(v.alerta)} · {formatKm(v.km_atual)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <AlertaBadge nivel={v.alerta.nivel} />
                      <Link href={`/manutencoes/nova?veiculo=${v.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                        Registrar
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Últimos checklists</CardTitle>
          <Link href="/checklists" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {(ultimosChecklists ?? []).length === 0 ? (
            <EmptyState icon={<ClipboardCheck />} title="Nenhum checklist enviado ainda" />
          ) : (
            <ul className="divide-y">
              {(ultimosChecklists ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <Link href={`/checklists/${c.id}`} className="min-w-0 hover:underline">
                    <span className="font-medium">{c.veiculos ? formatPlaca(c.veiculos.placa) : '—'}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.motoristas?.nome ?? '—'} · {formatDateTime(c.data_envio)}
                    </span>
                  </Link>
                  <ChecklistStatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const toneClass = {
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/25 text-warning-foreground dark:text-warning',
    danger: 'bg-destructive/15 text-destructive',
  };
  return (
    <Card className={`gap-2 py-4 ${className ?? ''}`}>
      <CardContent className="flex items-center gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5 ${tone ? toneClass[tone] : 'bg-accent text-accent-foreground'}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs leading-tight text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
