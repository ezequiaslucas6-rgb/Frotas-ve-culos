import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CarFront, ExternalLink, FileText, Fuel, Gauge, ShieldOff, TriangleAlert } from 'lucide-react';
import { ListaAbastecimentos } from '@/components/abastecimentos/lista-abastecimentos';
import { Placa } from '@/components/placa';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page-header';
import { AlertaBadge } from '@/components/ui/status-badges';
import { calcularConsumo, formatKmL } from '@/lib/abastecimento/consumo';
import { requireMotorista } from '@/lib/auth';
import { TIMEZONE, toISODate } from '@/lib/dates';
import { formatDateISO, formatKm } from '@/lib/format';
import { calcularAlertaRevisao } from '@/lib/maintenance/alerts';
import { descreverAlerta } from '@/lib/maintenance/describe';
import { descreverSituacaoCnh, situacaoCnh } from '@/lib/motoristas/cnh';
import { signedUrlMap } from '@/lib/storage';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Meu veículo' };

function saudacao() {
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, hour: 'numeric', hour12: false }).format(new Date()));
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}

export default async function MeuVeiculoPage() {
  const { supabase, profile } = await requireMotorista();
  const hoje = toISODate();
  const primeiroNome = profile.nome.split(' ')[0];

  // RLS: o motorista só recebe o próprio cadastro (se ativo), os veículos dele e os próprios lançamentos.
  const [{ data: eu }, { data: veiculos }, { data: abastecimentos }] = await Promise.all([
    supabase.from('motoristas').select('id, cnh_validade').maybeSingle(),
    supabase
      .from('veiculos')
      .select('id, placa, marca, modelo, ano, km_atual, foto_geral_url, documento_url, proxima_revisao_km, proxima_revisao_data')
      .order('placa'),
    supabase
      .from('abastecimentos')
      .select('id, veiculo_id, data_abastecimento, km, litros, valor_total, preco_litro, combustivel, tanque_cheio, posto, comprovante_url, veiculos(placa)')
      .order('data_abastecimento', { ascending: false })
      .order('km', { ascending: false })
      .limit(60),
  ]);

  if (!eu) {
    return (
      <EmptyState
        icon={<ShieldOff />}
        title="Acesso suspenso"
        description="Seu cadastro está inativo. Fale com o seu supervisor para reativá-lo."
      />
    );
  }

  const lista = veiculos ?? [];
  const lancamentos = abastecimentos ?? [];
  const [urlsVeiculos, urlsCupom] = await Promise.all([
    signedUrlMap(supabase, 'veiculos', lista.flatMap((v) => [v.foto_geral_url, v.documento_url])),
    signedUrlMap(supabase, 'abastecimentos', lancamentos.slice(0, 5).map((a) => a.comprovante_url)),
  ]);
  const consumoPorVeiculo = new Map(
    [...Map.groupBy(lancamentos, (a) => a.veiculo_id)].map(([id, itens]) => [id, calcularConsumo(itens)]),
  );
  const consumoGeral = Object.assign({}, ...[...consumoPorVeiculo.values()].map((c) => c.porLancamento));
  const cnh = situacaoCnh(eu.cnh_validade, hoje);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">{saudacao()},</p>
        <h1 className="text-[26px] font-bold tracking-tight">{primeiroNome}</h1>
      </div>

      {cnh.nivel === 'vencida' || cnh.nivel === 'vence' || cnh.nivel === 'sem_dados' ? (
        <Link
          href="/perfil"
          className={cn(
            'flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm',
            cnh.nivel === 'vencida' ? 'bg-destructive/15 text-destructive-text' : 'bg-warning/15 text-warning-text',
          )}
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <span>
            <strong className="block">
              {cnh.nivel === 'sem_dados' ? 'Validade da CNH não cadastrada' : `CNH: ${descreverSituacaoCnh(cnh).toLowerCase()}`}
            </strong>
            {cnh.nivel === 'sem_dados'
              ? 'Peça ao seu supervisor para completar o cadastro da CNH.'
              : `Validade ${formatDateISO(cnh.validade)}. Providencie a renovação e avise o seu supervisor.`}
          </span>
        </Link>
      ) : null}

      {lista.length === 0 ? (
        <EmptyState
          icon={<CarFront />}
          title="Nenhum veículo vinculado a você"
          description="Quando o supervisor definir você como responsável por um veículo, ele aparece aqui."
        />
      ) : (
        lista.map((v) => {
          const foto = v.foto_geral_url ? urlsVeiculos[v.foto_geral_url] : undefined;
          const doc = v.documento_url ? urlsVeiculos[v.documento_url] : undefined;
          const alerta = calcularAlertaRevisao(
            { kmAtual: v.km_atual, proximaRevisaoKm: v.proxima_revisao_km, proximaRevisaoData: v.proxima_revisao_data },
            hoje,
          );
          const consumo = consumoPorVeiculo.get(v.id)?.media ?? null;
          const ultimo = lancamentos.find((a) => a.veiculo_id === v.id);
          return (
            <Card key={v.id} className="overflow-hidden py-0">
              <div className="relative flex aspect-[16/9] items-center justify-center bg-raised text-muted-foreground sm:aspect-[21/9]">
                {foto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={foto} alt={`Foto do veículo ${v.placa}`} className="size-full object-cover" />
                ) : (
                  <CarFront className="size-16" />
                )}
                <Placa placa={v.placa} className="absolute bottom-3 left-3" />
              </div>
              <CardContent className="flex flex-col gap-5 pb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {[v.marca, v.modelo].filter(Boolean).join(' ') || 'Veículo'}
                    {v.ano ? <span className="font-normal text-muted-foreground"> · {v.ano}</span> : null}
                  </p>
                  <AlertaBadge nivel={alerta.nivel} />
                </div>

                <dl className="grid grid-cols-2 gap-3">
                  <Indicador icone={<Gauge />} rotulo="KM atual" valor={formatKm(v.km_atual)} />
                  <Indicador icone={<Fuel />} rotulo="Seu consumo médio" valor={formatKmL(consumo)} />
                  <Indicador
                    icone={<CalendarClock />}
                    rotulo="Próxima revisão"
                    valor={v.proxima_revisao_km != null ? formatKm(v.proxima_revisao_km) : formatDateISO(v.proxima_revisao_data)}
                    detalhe={descreverAlerta(alerta, false)}
                  />
                  <Indicador
                    icone={<Fuel />}
                    rotulo="Último abastecimento"
                    valor={ultimo ? formatDateISO(ultimo.data_abastecimento) : '—'}
                    detalhe={ultimo ? formatKm(ultimo.km) : 'Nenhum lançamento'}
                  />
                </dl>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Link href={`/abastecimentos/novo?veiculo=${v.id}`} className={cn(buttonVariants({ size: 'lg' }), 'sm:flex-1')}>
                    <Fuel /> Registrar abastecimento
                  </Link>
                  {doc ? (
                    <a href={doc} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                      <FileText /> Documento (CRLV) <ExternalLink />
                    </a>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {lancamentos.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Últimos abastecimentos</CardTitle>
            <Link href="/abastecimentos" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            <ListaAbastecimentos itens={lancamentos.slice(0, 5)} consumo={consumoGeral} urls={urlsCupom} mostrarVeiculo={lista.length > 1} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Indicador({ icone, rotulo, valor, detalhe }: { icone: React.ReactNode; rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-raised/70 p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icone}
        {rotulo}
      </dt>
      <dd className="text-[17px] leading-tight font-bold">{valor}</dd>
      {detalhe ? <dd className="text-xs text-muted-foreground">{detalhe}</dd> : null}
    </div>
  );
}
