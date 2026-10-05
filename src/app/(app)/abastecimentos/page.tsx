import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleCheck, Droplet, Fuel, Gauge, Plus, Receipt } from 'lucide-react';
import { excluirAbastecimento } from '@/actions/abastecimentos';
import { ListaAbastecimentos } from '@/components/abastecimentos/lista-abastecimentos';
import { FilialFilter } from '@/components/filial-filter';
import { Pagination } from '@/components/pagination';
import { ParamSelect } from '@/components/param-select';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { calcularConsumo, formatKmL, formatLitros, formatPrecoLitro } from '@/lib/abastecimento/consumo';
import { requireSession } from '@/lib/auth';
import { addDays, toISODate } from '@/lib/dates';
import { formatBRL } from '@/lib/format';
import { PAGE_SIZE, parsePage, resolveFilialFilter, type SearchParams } from '@/lib/pagination';
import { signedUrlMap } from '@/lib/storage';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Abastecimentos' };

const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (ym: string) => `${MESES_LONGOS[Number(ym.slice(5)) - 1]}/${ym.slice(0, 4)}`;

/** Os últimos 12 meses (YYYY-MM), do atual para trás. */
function ultimosMeses(hoje: string): string[] {
  let [ano, mes] = hoje.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, () => {
    const ym = `${ano}-${String(mes).padStart(2, '0')}`;
    mes -= 1;
    if (mes === 0) [ano, mes] = [ano - 1, 12];
    return ym;
  });
}

const proximoMes = (ym: string) => {
  const [ano, mes] = ym.split('-').map(Number) as [number, number];
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
};

const uuidOk = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export default async function AbastecimentosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession({ motorista: true });
  const { supabase, isAdmin, isMotorista } = session;

  const meses = ultimosMeses(toISODate());
  const mes = typeof sp.mes === 'string' && meses.includes(sp.mes) ? sp.mes : meses[0]!;
  const filialId = isMotorista ? null : resolveFilialFilter(session, sp);
  const veiculoId = uuidOk(sp.veiculo) ? sp.veiculo : null;
  const motoristaId = !isMotorista && uuidOk(sp.motorista) ? sp.motorista : null;
  const page = parsePage(sp.page);

  // O mês inteiro (para os totais) + 60 dias antes, só para fechar o km/l do 1º tanque cheio do mês.
  // A lista é paginada em memória. A RLS limita o motorista aos próprios lançamentos.
  const inicio = `${mes}-01`;
  let query = supabase
    .from('abastecimentos')
    .select(
      'id, veiculo_id, data_abastecimento, km, litros, valor_total, preco_litro, combustivel, tanque_cheio, posto, comprovante_url, veiculos(placa), motoristas(nome)',
    )
    .gte('data_abastecimento', addDays(inicio, -60))
    .lt('data_abastecimento', `${proximoMes(mes)}-01`)
    .order('data_abastecimento', { ascending: false })
    .order('km', { ascending: false })
    .limit(2000);
  if (filialId) query = query.eq('filial_id', filialId);
  if (veiculoId) query = query.eq('veiculo_id', veiculoId);
  if (motoristaId) query = query.eq('motorista_id', motoristaId);

  let veiculosQ = supabase.from('veiculos').select('id, placa').order('placa');
  if (filialId) veiculosQ = veiculosQ.eq('filial_id', filialId);

  const [{ data }, { data: veiculos }, { data: filiais }] = await Promise.all([
    query,
    isMotorista ? Promise.resolve({ data: null }) : veiculosQ,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);
  const comContexto = data ?? [];
  const itens = comContexto.filter((a) => a.data_abastecimento >= inicio);

  const consumos = [...Map.groupBy(comContexto, (a) => a.veiculo_id).values()].map((lista) => calcularConsumo(lista));
  const doMes = new Set(itens.map((a) => a.id));
  const consumo: Record<string, number> = Object.fromEntries(
    consumos.flatMap((c) => Object.entries(c.porLancamento)).filter(([id]) => doMes.has(id)),
  );
  const totalValor = itens.reduce((s, a) => s + Number(a.valor_total), 0);
  const liquidos = itens.filter((a) => a.combustivel !== 'gnv');
  const totalLitros = liquidos.reduce((s, a) => s + Number(a.litros), 0);
  const precoMedio = totalLitros > 0 ? liquidos.reduce((s, a) => s + Number(a.valor_total), 0) / totalLitros : null;
  const ciclos = Object.values(consumo);
  const mediaKmL = ciclos.length ? ciclos.reduce((s, v) => s + v, 0) / ciclos.length : null;

  const pagina = itens.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const urls = await signedUrlMap(supabase, 'abastecimentos', pagina.map((a) => a.comprovante_url));
  const motoristaFiltrado = motoristaId ? itens.find((a) => a.motoristas)?.motoristas?.nome : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isMotorista ? 'Meus abastecimentos' : 'Abastecimentos'}
        description={`${nomeMes(mes)} · ${itens.length} lançamento(s)${motoristaFiltrado ? ` · ${motoristaFiltrado}` : ''}`}
        actions={
          <Link href={veiculoId ? `/abastecimentos/novo?veiculo=${veiculoId}` : '/abastecimentos/novo'} className={buttonVariants()}>
            <Plus /> Registrar abastecimento
          </Link>
        }
      />

      {sp.registrado === '1' ? (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-success/15 px-4 py-3 text-sm font-medium text-success-text">
          <CircleCheck className="size-4" /> Abastecimento registrado. Obrigado!
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <ParamSelect
          param="mes"
          label="Mês"
          padrao={meses[0]}
          opcoes={meses.map((m) => ({ value: m, label: nomeMes(m) }))}
        />
        {veiculos ? (
          <ParamSelect
            param="veiculo"
            label="Veículo"
            todos="Todos os veículos"
            opcoes={veiculos.map((v) => ({ value: v.id, label: formatPlaca(v.placa) }))}
          />
        ) : null}
        {isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
        {motoristaId ? (
          <Link href="/abastecimentos" className={buttonVariants({ variant: 'ghost' })}>
            Limpar filtro de motorista
          </Link>
        ) : null}
      </div>

      <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Resumo icone={<Receipt />} rotulo="Gasto no mês" valor={formatBRL(totalValor)} />
        <Resumo icone={<Droplet />} rotulo="Litros" valor={formatLitros(totalLitros)} />
        <Resumo icone={<Fuel />} rotulo="Preço médio" valor={precoMedio ? `${formatPrecoLitro(precoMedio)}/L` : '—'} />
        <Resumo icone={<Gauge />} rotulo="Consumo médio" valor={formatKmL(mediaKmL)} />
      </section>

      {itens.length === 0 ? (
        <EmptyState
          icon={<Fuel />}
          title="Nenhum abastecimento neste mês"
          description={isMotorista ? 'Toque em "Registrar abastecimento" logo após abastecer.' : undefined}
        />
      ) : (
        <Card className="py-2">
          <CardContent>
            <ListaAbastecimentos
              itens={pagina}
              consumo={consumo}
              urls={urls}
              mostrarVeiculo
              mostrarMotorista={!isMotorista}
              acoes={
                isAdmin
                  ? (a) => (
                      <DeleteButton
                        action={excluirAbastecimento}
                        id={a.id}
                        size="icon"
                        confirmMessage="Excluir este lançamento de abastecimento?"
                      />
                    )
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      <Pagination basePath="/abastecimentos" searchParams={{ ...sp, registrado: undefined }} page={page} total={itens.length} />
    </div>
  );
}

function Resumo({ icone, rotulo, valor }: { icone: React.ReactNode; rotulo: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-card p-4 sm:p-5">
      <div className="min-w-0">
        <p className="truncate text-xl font-bold tracking-tight sm:text-2xl">{valor}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{rotulo}</p>
      </div>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-icone/15 text-icone [&_svg]:size-[18px]">
        {icone}
      </span>
    </div>
  );
}
