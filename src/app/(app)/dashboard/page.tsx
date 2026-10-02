import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CircleCheck, ClipboardCheck, Plus, TriangleAlert, Wrench } from 'lucide-react';
import { AtualizarAlertasButton } from '@/components/atualizar-alertas-button';
import { Donut } from '@/components/charts/donut';
import { Sparkline, type Ponto } from '@/components/charts/sparkline';
import { FilialFilter } from '@/components/filial-filter';
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
import { cn } from '@/lib/utils';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Painel' };

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Os últimos `n` meses (YYYY-MM), do mais antigo ao atual. */
function ultimosMeses(hoje: string, n: number): string[] {
  let [ano, mes] = hoje.split('-').map(Number) as [number, number];
  const lista: string[] = [];
  for (let i = 0; i < n; i++) {
    lista.unshift(`${ano}-${String(mes).padStart(2, '0')}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  return lista;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin, profile } = session;
  const filialId = resolveFilialFilter(session, sp);
  const hoje = toISODate();
  const meses = ultimosMeses(hoje, 6);
  const inicioMes = `${meses.at(-1)}-01`;

  let veiculosQ = supabase.from('vw_veiculos_painel').select('*').order('placa');
  let custosQ = supabase.from('manutencoes').select('custo, filial_id, data_manutencao').gte('data_manutencao', `${meses[0]}-01`);
  let checklistsMesQ = supabase.from('checklists').select('veiculo_id').gte('data_envio', `${inicioMes}T00:00:00-03:00`);
  let ultimosQ = supabase
    .from('checklists')
    .select('id, data_envio, status, veiculos(placa, modelo), motoristas(nome)')
    .order('data_envio', { ascending: false })
    .limit(6);
  if (filialId) {
    veiculosQ = veiculosQ.eq('filial_id', filialId);
    custosQ = custosQ.eq('filial_id', filialId);
    checklistsMesQ = checklistsMesQ.eq('filial_id', filialId);
    ultimosQ = ultimosQ.eq('filial_id', filialId);
  }

  const [{ data: veiculosRaw }, { data: custos }, { data: checklistsMes }, { data: ultimos }, { data: filiais }] = await Promise.all([
    veiculosQ,
    custosQ,
    checklistsMesQ,
    ultimosQ,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);

  const veiculos = (veiculosRaw ?? []).map((v) => ({ ...v, ...avaliarVeiculoPainel(v, hoje) }));
  const total = veiculos.length;
  const conta = (s: string) => veiculos.filter((v) => v.saude === s).length;
  const liberados = conta('liberado');
  const atencao = conta('atencao');
  const manutencao = conta('manutencao');
  const verificados = new Set((checklistsMes ?? []).map((c) => c.veiculo_id)).size;

  // custo por mês (série única)
  const porMes = new Map(meses.map((m) => [m, 0]));
  for (const c of custos ?? []) {
    const m = String(c.data_manutencao).slice(0, 7);
    if (porMes.has(m)) porMes.set(m, (porMes.get(m) ?? 0) + Number(c.custo));
  }
  const serie: Ponto[] = meses.map((m) => ({
    rotulo: MESES[Number(m.slice(5)) - 1]!,
    rotuloLongo: `${MESES_LONGOS[Number(m.slice(5)) - 1]}/${m.slice(0, 4)}`,
    valor: porMes.get(m) ?? 0,
    texto: formatBRL(porMes.get(m) ?? 0),
  }));
  const custoMes = serie.at(-1)!.valor;
  const custoAnterior = serie.at(-2)!.valor;
  const variacao = custoAnterior > 0 ? ((custoMes - custoAnterior) / custoAnterior) * 100 : null;
  const custo6m = serie.reduce((s, p) => s + p.valor, 0);

  const requerAtencao = veiculos
    .filter((v) => v.saude !== 'liberado')
    .sort((a, b) => (a.saude === b.saude ? a.placa.localeCompare(b.placa) : a.saude === 'manutencao' ? -1 : 1));
  const alertas = veiculos
    .filter((v) => v.alerta.nivel !== 'ok')
    .sort((a, b) => (a.alerta.nivel === b.alerta.nivel ? 0 : a.alerta.nivel === 'vencido' ? -1 : 1));

  const escopo = filialId ? (filiais?.find((f) => f.id === filialId) ?? profile.filiais) : null;
  const porFilial =
    isAdmin && !filialId
      ? (filiais ?? []).map((f) => {
          const doFilial = veiculos.filter((v) => v.filial_id === f.id);
          return {
            filial: f,
            total: doFilial.length,
            liberado: doFilial.filter((v) => v.saude === 'liberado').length,
            atencao: doFilial.filter((v) => v.saude === 'atencao').length,
            manutencao: doFilial.filter((v) => v.saude === 'manutencao').length,
            custo: (custos ?? [])
              .filter((m) => m.filial_id === f.id && String(m.data_manutencao) >= inicioMes)
              .reduce((acc, m) => acc + Number(m.custo), 0),
          };
        })
      : [];

  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Painel"
        description={escopo ? `Filial ${formatFilial(escopo)}` : 'Todas as filiais'}
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
        <p role="alert" className="rounded-xl bg-destructive/15 px-4 py-3 text-sm text-destructive-text">
          Você não tem permissão para acessar essa área.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="gap-2 px-6 pt-6 pb-4 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Custo de manutenção · {MESES_LONGOS[Number(meses.at(-1)!.slice(5)) - 1]}</p>
              <p className="mt-1 text-4xl font-bold tracking-tight">{formatBRL(custoMes)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {variacao == null ? 'Sem lançamentos no mês anterior' : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}% em relação ao mês anterior`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Últimos 6 meses</p>
              <p className="text-lg font-semibold">{formatBRL(custo6m)}</p>
            </div>
          </div>
          <Sparkline pontos={serie} titulo="Custo de manutenção por mês, últimos 6 meses" />
        </Card>

        <Card className="px-6 py-6">
          <CardTitle>Saúde da frota</CardTitle>
          <Donut
            totalRotulo={total === 1 ? 'veículo' : 'veículos'}
            fatias={[
              { chave: 'liberado', rotulo: 'Liberados', valor: liberados, cor: 'var(--success)', icone: <CircleCheck /> },
              { chave: 'atencao', rotulo: 'Atenção', valor: atencao, cor: 'var(--warning)', icone: <TriangleAlert /> },
              { chave: 'manutencao', rotulo: 'Manutenção/Avaria', valor: manutencao, cor: 'var(--destructive)', icone: <Wrench /> },
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section aria-label="Indicadores" className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatTile valor={liberados} rotulo="Liberados" pct={pct(liberados)} cor="var(--success)" icone={<CircleCheck />} />
          <StatTile valor={atencao} rotulo="Em atenção" pct={pct(atencao)} cor="var(--warning)" icone={<TriangleAlert />} />
          <StatTile valor={manutencao} rotulo="Manutenção/Avaria" pct={pct(manutencao)} cor="var(--destructive)" icone={<Wrench />} />
          <StatTile
            valor={verificados}
            rotulo={`Checklist no mês · de ${total}`}
            pct={pct(verificados)}
            cor="var(--primary)"
            icone={<ClipboardCheck />}
          />
        </section>

        <Card className="gap-3 px-6 py-6">
          <div className="flex items-center justify-between">
            <CardTitle>Revisões</CardTitle>
            <span className="text-xs text-muted-foreground">{alertas.length} pendente(s)</span>
          </div>
          {alertas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma revisão próxima ou vencida.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Veículo</th>
                  <th className="pb-2 font-medium">Prazo</th>
                  <th className="pb-2 text-right font-medium">KM</th>
                </tr>
              </thead>
              <tbody>
                {alertas.slice(0, 6).map((v) => (
                  <tr key={v.id} className="border-t border-border/60">
                    <td className="py-2.5">
                      <Link href={`/veiculos/${v.id}`} className="font-semibold hover:underline">
                        {formatPlaca(v.placa)}
                      </Link>
                      <div className="mt-0.5">
                        <AlertaBadge nivel={v.alerta.nivel} />
                      </div>
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">{descreverAlerta(v.alerta)}</td>
                    <td className="py-2.5 text-right text-xs">{formatKm(v.km_atual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {alertas.length > 0 ? (
            <Link href="/manutencoes/nova" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-1')}>
              Registrar revisão <ArrowRight />
            </Link>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="px-0">
          <CardHeader>
            <CardTitle>Requer atenção</CardTitle>
          </CardHeader>
          <CardContent>
            {requerAtencao.length === 0 ? (
              <EmptyState icon={<CircleCheck />} title="Toda a frota está liberada" />
            ) : (
              <ul className="divide-y divide-border/60">
                {requerAtencao.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={`/veiculos/${v.id}`} className="font-semibold hover:underline">
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

        <Card className="px-0">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Últimos checklists</CardTitle>
            <Link href="/checklists" className="text-xs font-semibold text-primary hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {(ultimos ?? []).length === 0 ? (
              <EmptyState icon={<ClipboardCheck />} title="Nenhum checklist enviado ainda" />
            ) : (
              <ul className="divide-y divide-border/60">
                {(ultimos ?? []).map((c) => (
                  <li key={c.id}>
                    <Link href={`/checklists/${c.id}`} className="flex items-center justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="font-semibold">{c.veiculos ? formatPlaca(c.veiculos.placa) : '—'}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.motoristas?.nome ?? '—'} · {formatDateTime(c.data_envio)}
                        </span>
                      </span>
                      <ChecklistStatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {porFilial.length > 0 ? (
        <Card className="px-0">
          <CardHeader>
            <CardTitle>Por filial</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filial</TableHead>
                  <TableHead className="text-right">Veículos</TableHead>
                  <TableHead className="text-right">Liberados</TableHead>
                  <TableHead className="text-right">Atenção</TableHead>
                  <TableHead className="text-right">Manutenção</TableHead>
                  <TableHead className="text-right">Custo no mês</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porFilial.map((r) => (
                  <TableRow key={r.filial.id}>
                    <TableCell className="font-semibold">
                      <Link href={`/dashboard?filial=${r.filial.id}`} className="hover:underline">
                        {formatFilial(r.filial)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{r.total}</TableCell>
                    <TableCell className="text-right text-success-text">{r.liberado}</TableCell>
                    <TableCell className="text-right text-warning-text">{r.atencao}</TableCell>
                    <TableCell className="text-right text-destructive-text">{r.manutencao}</TableCell>
                    <TableCell className="text-right">{formatBRL(r.custo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatTile({ valor, rotulo, pct, cor, icone }: { valor: number; rotulo: string; pct: number; cor: string; icone: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-3xl font-bold tracking-tight">{valor}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{rotulo}</p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5" style={{ color: cor, background: `color-mix(in oklab, ${cor} 16%, transparent)` }}>
          {icone}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-9 text-xs font-semibold text-muted-foreground">{pct}%</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={rotulo}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor }} />
        </div>
      </div>
    </div>
  );
}
