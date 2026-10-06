import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CircleCheck, ClipboardCheck, IdCard, Plus, TriangleAlert, Wrench } from 'lucide-react';
import { AtualizarAlertasButton } from '@/components/atualizar-alertas-button';
import { BombaCombustivel } from '@/components/icones/bomba-combustivel';
import { CobrancaChecklists } from '@/components/painel/cobranca-checklists';
import { Badge } from '@/components/ui/badge';
import { Donut } from '@/components/charts/donut';
import { Sparkline, type Ponto } from '@/components/charts/sparkline';
import { FilialFilter } from '@/components/filial-filter';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { AlertaBadge, ChecklistStatusBadge, CnhBadge, SaudeBadge } from '@/components/ui/status-badges';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { descreverAnomalia, detectarConsumoAnormal, formatKmL } from '@/lib/abastecimento/consumo';
import { requireSession } from '@/lib/auth';
import { periodosCobranca, resumoCobranca, situacaoDaView } from '@/lib/checklist/cobranca';
import { tipoLabel } from '@/lib/checklist/etapas';
import { addDays, toISODate } from '@/lib/dates';
import { formatBRL, formatDateISO, formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import { descreverAlerta } from '@/lib/maintenance/describe';
import { CNH_AVISO_DIAS, situacaoCnh } from '@/lib/motoristas/cnh';
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
  const periodos = periodosCobranca(hoje);

  let veiculosQ = supabase.from('vw_veiculos_painel').select('*').order('placa');
  let custosQ = supabase.from('manutencoes').select('custo, filial_id, data_manutencao').gte('data_manutencao', `${meses[0]}-01`);
  // 6 meses de abastecimentos: custo por mês e a referência de consumo (km/l) de cada veículo
  let combustivelQ = supabase
    .from('abastecimentos')
    .select('id, veiculo_id, km, litros, tanque_cheio, combustivel, valor_total, filial_id, data_abastecimento')
    .gte('data_abastecimento', `${meses[0]}-01`);
  // CNH vencida, vencendo em até 30 dias ou sem validade (motoristas em atividade)
  let cnhQ = supabase
    .from('motoristas')
    .select('id, nome, cnh_validade, filial_id')
    .neq('status', 'inativo')
    .or(`cnh_validade.is.null,cnh_validade.lte.${addDays(hoje, CNH_AVISO_DIAS)}`)
    .order('cnh_validade', { ascending: true, nullsFirst: false })
    .limit(50);
  let ultimosQ = supabase
    .from('checklists')
    .select('id, data_envio, tipo, status, veiculos(placa, modelo), motoristas(nome)')
    .order('data_envio', { ascending: false })
    .limit(6);
  if (filialId) {
    veiculosQ = veiculosQ.eq('filial_id', filialId);
    custosQ = custosQ.eq('filial_id', filialId);
    combustivelQ = combustivelQ.eq('filial_id', filialId);
    cnhQ = cnhQ.eq('filial_id', filialId);
    ultimosQ = ultimosQ.eq('filial_id', filialId);
  }

  const [
    { data: veiculosRaw },
    { data: custos },
    { data: ultimos },
    { data: filiais },
    { data: combustivel },
    { data: cnhs },
  ] = await Promise.all([
    veiculosQ,
    custosQ,
    ultimosQ,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
    combustivelQ,
    cnhQ,
  ]);

  const agora = new Date();
  const veiculos = (veiculosRaw ?? []).map((v) => ({ ...v, ...avaliarVeiculoPainel(v, hoje, agora) }));
  const total = veiculos.length;
  const conta = (s: string) => veiculos.filter((v) => v.saude === s).length;
  const liberados = conta('liberado');
  const atencao = conta('atencao');
  const manutencao = conta('manutencao');
  // parados por avaria aguardam conserto: ficam fora da cobrança (o semanal atrasado continua cobrado)
  const operando = veiculos.filter((v) => v.bloqueio !== 'avaria');
  const resumo = resumoCobranca(operando, new Map(operando.map((v) => [v.id, situacaoDaView(v, hoje)])));
  const diarioADecidir = operando.filter((v) => v.diaria === 'decidir').length;
  const semanalAtrasado = operando.filter((v) => v.semanal === 'atrasado').length;

  // consumo fora do padrão no último tanque (dos últimos 60 dias)
  const abastecimentosPorVeiculo = Map.groupBy(combustivel ?? [], (a) => a.veiculo_id);
  const consumoAnormal = veiculos
    .map((v) => ({ v, a: detectarConsumoAnormal(abastecimentosPorVeiculo.get(v.id) ?? []).ultima }))
    .filter((x): x is { v: (typeof veiculos)[number]; a: NonNullable<typeof x.a> } => x.a != null && x.a.data >= addDays(hoje, -60))
    .sort((x, y) => x.a.variacao - y.a.variacao);

  // custos por mês em duas séries SEPARADAS (manutenção x combustível), para não misturar
  const manutencaoMes = new Map(meses.map((m) => [m, 0]));
  const combustivelMes = new Map(meses.map((m) => [m, 0]));
  const somar = (mapa: Map<string, number>, data: string, valor: number) => {
    const m = data.slice(0, 7);
    if (mapa.has(m)) mapa.set(m, (mapa.get(m) ?? 0) + valor);
  };
  for (const c of custos ?? []) somar(manutencaoMes, String(c.data_manutencao), Number(c.custo));
  for (const a of combustivel ?? []) somar(combustivelMes, String(a.data_abastecimento), Number(a.valor_total));
  const serieDe = (mapa: Map<string, number>): Ponto[] =>
    meses.map((m) => {
      const valor = mapa.get(m) ?? 0;
      return {
        rotulo: MESES[Number(m.slice(5)) - 1]!,
        rotuloLongo: `${MESES_LONGOS[Number(m.slice(5)) - 1]}/${m.slice(0, 4)}`,
        valor,
        texto: formatBRL(valor),
      };
    });
  const mesAtual = meses.at(-1)!;
  const nomeMesAtual = MESES_LONGOS[Number(mesAtual.slice(5)) - 1]!;

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
            combustivel: (combustivel ?? [])
              .filter((a) => a.filial_id === f.id && String(a.data_abastecimento) >= inicioMes)
              .reduce((acc, a) => acc + Number(a.valor_total), 0),
          };
        })
      : [];

  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const alertasCnh = (cnhs ?? [])
    .map((m) => ({ ...m, situacao: situacaoCnh(m.cnh_validade, hoje) }))
    .filter((m) => m.situacao.nivel !== 'ok');

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

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <CustoCard
          titulo="Manutenção"
          mes={nomeMesAtual}
          serie={serieDe(manutencaoMes)}
          cor="var(--serie-manutencao)"
          icone={<Wrench />}
          link={{ href: '/manutencoes', texto: 'Ver manutenções' }}
        />
        <CustoCard
          titulo="Combustível"
          mes={nomeMesAtual}
          serie={serieDe(combustivelMes)}
          cor="var(--serie-combustivel)"
          icone={<BombaCombustivel />}
          link={{ href: '/abastecimentos/acompanhamento', texto: 'Acompanhar abastecimentos' }}
        />

        <Card className="px-6 py-6 md:col-span-2 xl:col-span-1">
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section aria-label="Indicadores" className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatTile valor={liberados} rotulo="Liberados" pct={pct(liberados)} cor="var(--success)" icone={<CircleCheck />} />
          <StatTile valor={atencao} rotulo="Em atenção" pct={pct(atencao)} cor="var(--warning)" icone={<TriangleAlert />} />
          <StatTile valor={manutencao} rotulo="Manutenção/Avaria" pct={pct(manutencao)} cor="var(--destructive)" icone={<Wrench />} />
          <StatTile
            valor={resumo.diario.feitos}
            rotulo={`Diário hoje · de ${resumo.diario.total}`}
            pct={resumo.diario.total ? Math.round((resumo.diario.feitos / resumo.diario.total) * 100) : 0}
            cor="var(--icone)"
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
                    <td className="py-2.5 text-right text-xs whitespace-nowrap">{formatKm(v.km_atual)}</td>
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CobrancaChecklists
          resumo={resumo}
          periodos={periodos}
          foraDaCobranca={total - operando.length}
          diarioADecidir={diarioADecidir}
          semanalAtrasado={semanalAtrasado}
          className="lg:col-span-2"
        />

        <Card className="gap-3 px-6 py-6">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Consumo fora do padrão</CardTitle>
            <span className="text-xs text-muted-foreground">{consumoAnormal.length} veículo(s)</span>
          </div>
          {consumoAnormal.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum consumo fora do padrão.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {consumoAnormal.slice(0, 6).map(({ v, a }) => (
                <li key={v.id}>
                  <Link href={`/veiculos/${v.id}`} className="flex items-start justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="font-semibold">{formatPlaca(v.placa)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatKmL(a.kml)} · normal {formatKmL(a.referencia)} · {formatDateISO(a.data)}
                      </span>
                    </span>
                    <Badge variant={a.tipo === 'queda' ? 'danger' : 'warning'} className="shrink-0">
                      {descreverAnomalia(a).replace(' do normal', '')}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-auto text-xs text-muted-foreground">
            Queda de 25% ou mais no km/l: possível vazamento, desvio de combustível ou KM digitado errado.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
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
                    <SaudeBadge saude={v.saude} naoLiberado={v.naoLiberado} />
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
                          {tipoLabel(c.tipo)} · {c.motoristas?.nome ?? '—'} · {formatDateTime(c.data_envio)}
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

        <Card className="px-0">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>CNH dos motoristas</CardTitle>
            <span className="text-xs text-muted-foreground">{alertasCnh.length} pendência(s)</span>
          </CardHeader>
          <CardContent>
            {alertasCnh.length === 0 ? (
              <EmptyState icon={<IdCard />} title="Todas as CNHs em dia" />
            ) : (
              <ul className="divide-y divide-border/60">
                {alertasCnh.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <Link href={`/motoristas/${m.id}`} className="flex items-center justify-between gap-3 py-3">
                      <span className="min-w-0 truncate font-semibold">{m.nome}</span>
                      <CnhBadge situacao={m.situacao} />
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
                  <TableHead className="text-right">Manutenção no mês</TableHead>
                  <TableHead className="text-right">Combustível no mês</TableHead>
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
                    <TableCell className="text-right">{formatBRL(r.combustivel)}</TableCell>
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

/** "Manutenção/Avaria" pode quebrar depois da barra (sem isso a palavra inteira empurra o ícone para fora do cartão). */
const quebraAposBarra = (texto: string) =>
  texto.split('/').flatMap((parte, i, partes) => (i < partes.length - 1 ? [`${parte}/`, <wbr key={i} />] : [parte]));

function StatTile({ valor, rotulo, pct, cor, icone }: { valor: number; rotulo: string; pct: number; cor: string; icone: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-2xl bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="text-3xl font-bold tracking-tight">{valor}</p>
          <p className="mt-0.5 text-xs break-words text-muted-foreground">{quebraAposBarra(rotulo)}</p>
        </div>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl sm:size-10 [&_svg]:size-5"
          style={{ color: cor, background: `color-mix(in oklab, ${cor} 16%, transparent)` }}
        >
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

/** Custo do mês de UMA categoria, com a variação e a série dos últimos 6 meses. */
function CustoCard({
  titulo,
  mes,
  serie,
  cor,
  icone,
  link,
}: {
  titulo: string;
  mes: string;
  serie: Ponto[];
  cor: string;
  icone: React.ReactNode;
  link: { href: string; texto: string };
}) {
  const atual = serie.at(-1)?.valor ?? 0;
  const anterior = serie.at(-2)?.valor ?? 0;
  const variacao = anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;
  const total = serie.reduce((s, p) => s + p.valor, 0);
  return (
    <Card className="gap-2 px-6 pt-6 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex size-7 items-center justify-center rounded-lg [&_svg]:size-4" style={{ color: cor, background: `color-mix(in oklab, ${cor} 16%, transparent)` }}>
              {icone}
            </span>
            {titulo} · {mes}
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{formatBRL(atual)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {variacao == null ? 'Sem lançamentos no mês anterior' : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}% em relação ao mês anterior`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">6 meses</p>
          <p className="font-semibold">{formatBRL(total)}</p>
        </div>
      </div>
      <div className="mt-auto">
        <Sparkline pontos={serie} titulo={`Custo de ${titulo.toLowerCase()} por mês, últimos 6 meses`} altura={200} cor={cor} />
      </div>
      <Link href={link.href} className="mt-1 self-start text-xs font-semibold text-primary hover:underline">
        {link.texto} →
      </Link>
    </Card>
  );
}
