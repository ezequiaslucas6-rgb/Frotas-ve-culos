import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Droplet, Gauge, Receipt, TicketPercent, TriangleAlert } from 'lucide-react';
import { FilialFilter } from '@/components/filial-filter';
import { BombaCombustivel } from '@/components/icones/bomba-combustivel';
import { FormFiltros } from '@/components/navegacao';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SITUACOES, type Agrupado, type LinhaAcompanhamento } from '@/lib/abastecimento/acompanhamento';
import { carregarAcompanhamento, lerParametros, paramsDaUrl } from '@/lib/abastecimento/acompanhamento-dados';
import { COMBUSTIVEIS, combustivelLabel, descreverAnomalia, dicaAnomalia, formatKmL, formatLitros, formatPrecoLitro } from '@/lib/abastecimento/consumo';
import { requireSession } from '@/lib/auth';
import { formatBRL, formatDateISO, formatDateTime, formatKm, formatNumber } from '@/lib/format';
import { PAGE_SIZE, parsePage, type SearchParams } from '@/lib/pagination';
import { signedUrlMap } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Acompanhamento de abastecimentos' };

const pct = (parte: number, total: number) => (total > 0 ? `${((parte / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
const precoOuTraco = (v: number | null) => (v == null ? '—' : `${formatPrecoLitro(v)}/L`);
const custoKm = (v: number | null) => (v == null ? '—' : `${formatPrecoLitro(v)}/km`);

/**
 * Acompanhamento dos abastecimentos (supervisor da filial e admin): tudo o que foi lançado no
 * período, com o que foi pago, descontos, preço por litro, consumo, a conferência do cupom
 * e os totais por veículo, motorista e posto. Exporta a planilha com os mesmos filtros.
 */
export default async function AcompanhamentoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin } = session;
  const p = lerParametros(sp, session);
  const page = parsePage(sp.page);

  let veiculosQ = supabase.from('veiculos').select('id, placa').order('placa');
  let motoristasQ = supabase.from('motoristas').select('id, nome').order('nome');
  if (p.filialId) {
    veiculosQ = veiculosQ.eq('filial_id', p.filialId);
    motoristasQ = motoristasQ.eq('filial_id', p.filialId);
  }
  const [a, { data: veiculos }, { data: motoristas }, { data: filiais }] = await Promise.all([
    carregarAcompanhamento(supabase, p),
    veiculosQ,
    motoristasQ,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);
  const t = a.totais;
  const pagina = a.linhas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const urls = await signedUrlMap(supabase, 'abastecimentos', pagina.map((l) => l.comprovante));
  const query = paramsDaUrl(p, isAdmin);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Acompanhamento de abastecimentos"
        description={`${formatDateISO(p.de)} a ${formatDateISO(p.ate)} · ${t.quantidade} lançamento(s)`}
        actions={
          <>
            {isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
            <a href={`/abastecimentos/acompanhamento/exportar?${query}`} className={buttonVariants({ variant: 'outline' })} download>
              <Download /> Exportar planilha
            </a>
          </>
        }
      />

      <FormFiltros className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {p.filialId && isAdmin ? <input type="hidden" name="filial" value={p.filialId} /> : null}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          De
          <Input type="date" name="de" defaultValue={p.de} className="h-10" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Até
          <Input type="date" name="ate" defaultValue={p.ate} className="h-10" />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
          Veículo
          <Select name="veiculo" defaultValue={p.veiculoId ?? ''} className="h-10">
            <option value="">Todos</option>
            {(veiculos ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {formatPlaca(v.placa)}
              </option>
            ))}
          </Select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
          Motorista
          <Select name="motorista" defaultValue={p.motoristaId ?? ''} className="h-10">
            <option value="">Todos</option>
            {(motoristas ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Combustível
          <Select name="combustivel" defaultValue={p.combustivel ?? ''} className="h-10">
            <option value="">Todos</option>
            {COMBUSTIVEIS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Posto
          <Input name="posto" defaultValue={p.posto ?? ''} placeholder="Nome do posto" className="h-10" />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
          Situação
          <Select name="situacao" defaultValue={p.situacao} className="h-10">
            {SITUACOES.map((s) => (
              <option key={s.value} value={s.value === 'todos' ? '' : s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <Button type="submit" variant="secondary" className="h-10 w-full">
            Filtrar
          </Button>
        </div>
      </FormFiltros>

      <section aria-label="Totais do período" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Indicador icone={<Receipt />} rotulo="Valor pago" valor={formatBRL(t.valorPago)} detalhe={`Total sem desconto ${formatBRL(t.valorBruto)}`} />
        <Indicador icone={<TicketPercent />} rotulo="Descontos" valor={formatBRL(t.desconto)} detalhe={`${pct(t.desconto, t.valorBruto)} do total`} />
        <Indicador icone={<Droplet />} rotulo="Litros" valor={formatLitros(t.litros)} detalhe={`${t.quantidade} abastecimento(s)`} />
        <Indicador
          icone={<BombaCombustivel />}
          rotulo="Preço médio com desconto"
          valor={precoOuTraco(t.precoMedio)}
          detalhe={`Bomba ${precoOuTraco(t.precoBombaMedio)}`}
        />
        <Indicador icone={<Gauge />} rotulo="Consumo médio" valor={formatKmL(t.kml)} detalhe={`${formatKm(t.kmRodados)} em tanques cheios`} />
        <Indicador icone={<Receipt />} rotulo="Custo por km" valor={custoKm(t.custoKm)} detalhe="Preço médio ÷ km/l" />
        <Indicador
          icone={<TriangleAlert />}
          rotulo="Cupons a conferir"
          valor={String(a.aConferir)}
          detalhe="Leitura não conferiu, valor mudado à mão ou placa diferente"
          alerta={a.aConferir > 0}
        />
        <Indicador icone={<Receipt />} rotulo="Sem foto do cupom" valor={String(a.semComprovante)} alerta={a.semComprovante > 0} />
      </section>

      {t.quantidade === 0 ? (
        <EmptyState icon={<BombaCombustivel />} title="Nenhum abastecimento com esses filtros" description="Mude o período ou os filtros acima." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Agrupamento titulo="Por veículo" itens={a.porVeiculo} rotulo="Veículo" placa />
            <Agrupamento titulo="Por motorista" itens={a.porMotorista} rotulo="Motorista" />
          </div>
          <Agrupamento titulo="Por posto" itens={a.porPosto} rotulo="Posto" postos />

          <Card className="px-0">
            <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Lançamentos</CardTitle>
              <span className="text-xs text-muted-foreground">Mais recentes primeiro · toque no comprovante para ver a foto</span>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border/60">
                {pagina.map((l) => (
                  <Lancamento key={l.id} l={l} foto={l.comprovante ? urls[l.comprovante] : undefined} />
                ))}
              </ul>
            </CardContent>
          </Card>
          <Pagination basePath="/abastecimentos/acompanhamento" searchParams={sp} page={page} total={a.linhas.length} />
        </>
      )}
    </div>
  );
}

function Indicador({ icone, rotulo, valor, detalhe, alerta }: { icone: React.ReactNode; rotulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-card p-4 sm:p-5">
      <div className="min-w-0">
        <p className={cn('truncate text-xl font-bold tracking-tight sm:text-2xl', alerta && 'text-warning-text')}>{valor}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{rotulo}</p>
        {detalhe ? <p className="mt-1 text-xs text-muted-foreground/80">{detalhe}</p> : null}
      </div>
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
          alerta ? 'bg-warning/15 text-warning-text' : 'bg-icone/15 text-icone',
        )}
      >
        {icone}
      </span>
    </div>
  );
}

function Agrupamento({ titulo, itens, rotulo, placa, postos }: { titulo: string; itens: Agrupado[]; rotulo: string; placa?: boolean; postos?: boolean }) {
  return (
    <Card className="px-0">
      <CardHeader className="flex-row items-baseline justify-between gap-2">
        <CardTitle>{titulo}</CardTitle>
        <span className="text-xs text-muted-foreground">{itens.length}</span>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{rotulo}</TableHead>
              <TableHead className="text-right">Abast.</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">Desconto</TableHead>
              <TableHead className="text-right">R$/L c/ desc.</TableHead>
              {postos ? <TableHead className="text-right">R$/L bomba</TableHead> : <TableHead className="text-right">km/l</TableHead>}
              {postos ? null : <TableHead className="text-right">R$/km</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((g) => (
              <TableRow key={g.chave}>
                <TableCell className="max-w-[220px]">
                  <span className="block truncate font-semibold">{placa ? formatPlaca(g.nome) : g.nome}</span>
                  {g.detalhe ? <span className="block truncate text-xs text-muted-foreground">{g.detalhe}</span> : null}
                  {g.anomalias > 0 ? (
                    <Badge variant="danger" className="mt-1">
                      <TriangleAlert /> {g.anomalias} consumo fora do padrão
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{g.quantidade}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{formatNumber(Math.round(g.litros * 10) / 10)}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{formatBRL(g.valorPago)}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{g.desconto > 0 ? formatBRL(g.desconto) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{g.precoMedio == null ? '—' : formatPrecoLitro(g.precoMedio)}</TableCell>
                {postos ? (
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{g.precoBombaMedio == null ? '—' : formatPrecoLitro(g.precoBombaMedio)}</TableCell>
                ) : (
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{formatKmL(g.kml)}</TableCell>
                )}
                {postos ? null : <TableCell className="text-right tabular-nums whitespace-nowrap">{g.custoKm == null ? '—' : formatPrecoLitro(g.custoKm)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Lancamento({ l, foto }: { l: LinhaAcompanhamento; foto?: string }) {
  const unidade = l.combustivel === 'gnv' ? 'm³' : 'L';
  const c = l.cupom;
  return (
    <li className="flex flex-col gap-2 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">
          {formatDateISO(l.data)} ·{' '}
          <Link href={`/veiculos/${l.veiculoId}`} className="hover:underline">
            {formatPlaca(l.placa)}
          </Link>
          <span className="font-normal text-muted-foreground"> · {l.motorista ?? 'sem motorista'}</span>
        </p>
        <p className="font-semibold tabular-nums">{formatBRL(l.valorPago)}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4 lg:grid-cols-6">
        <Dado rotulo="Litros" valor={formatLitros(l.litros, l.combustivel)} />
        <Dado rotulo="Combustível" valor={combustivelLabel(l.combustivel)} />
        <Dado rotulo="Preço bomba" valor={l.precoBomba == null ? '—' : `${formatPrecoLitro(l.precoBomba)}/${unidade}`} />
        <Dado rotulo="Com desconto" valor={`${formatPrecoLitro(l.unitario)}/${unidade}`} destaque />
        <Dado rotulo="Valor total" valor={formatBRL(l.valorBruto)} />
        <Dado rotulo="Desconto" valor={l.desconto > 0 ? formatBRL(l.desconto) : '—'} />
        <Dado rotulo="KM" valor={formatKm(l.km)} />
        <Dado rotulo="Rodou desde o anterior" valor={l.kmDesdeAnterior == null ? '—' : formatKm(l.kmDesdeAnterior)} />
        <Dado rotulo="Consumo" valor={l.kml ? formatKmL(l.kml) : l.tanqueCheio ? '—' : 'parcial'} />
        <Dado rotulo="Posto" valor={l.posto ?? '—'} />
        <Dado rotulo="Registrado" valor={formatDateTime(l.registradoEm)} />
        <Dado rotulo="KM no cupom" valor={c.kmCupom ? formatKm(c.kmCupom) : '—'} />
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {l.tanqueCheio ? null : <Badge variant="secondary">Parcial</Badge>}
        {l.anomalia ? (
          <Badge variant={l.anomalia.tipo === 'queda' ? 'danger' : 'warning'} title={dicaAnomalia(l.anomalia)}>
            <TriangleAlert /> Consumo {descreverAnomalia(l.anomalia)}
          </Badge>
        ) : null}
        {c.origem === 'manual' ? (
          <Badge variant="secondary">Digitado à mão</Badge>
        ) : c.editado ? (
          <Badge variant="warning" title="Os valores gravados são diferentes dos lidos na foto do cupom">
            Valores mudados após a leitura
          </Badge>
        ) : c.conferido ? (
          <Badge variant="success">Cupom conferido</Badge>
        ) : c.corrigido ? (
          <Badge variant="warning">Leitura corrigida</Badge>
        ) : (
          <Badge variant="warning">Cupom a conferir</Badge>
        )}
        {c.placaConfere === false ? <Badge variant="danger">Placa do cupom diferente</Badge> : null}
        {foto ? (
          <a href={foto} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <Receipt className="size-3.5" /> Comprovante
          </a>
        ) : (
          <span className="text-muted-foreground">Sem foto do cupom</span>
        )}
      </div>
      {l.observacao ? <p className="text-xs text-muted-foreground">Obs.: {l.observacao}</p> : null}
    </li>
  );
}

function Dado({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={cn('truncate tabular-nums', destaque && 'font-semibold text-primary')}>{valor}</dd>
    </div>
  );
}
