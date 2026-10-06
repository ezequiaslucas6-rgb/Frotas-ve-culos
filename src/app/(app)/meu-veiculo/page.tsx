import type { Metadata } from 'next';
import Link from 'next/link';
import { Ban, CalendarClock, CarFront, CircleCheck, ClipboardCheck, ExternalLink, FileText, Gauge, ShieldOff, TriangleAlert } from 'lucide-react';
import { BombaCombustivel } from '@/components/icones/bomba-combustivel';
import { ListaAbastecimentos } from '@/components/abastecimentos/lista-abastecimentos';
import { Placa } from '@/components/placa';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page-header';
import { AlertaBadge } from '@/components/ui/status-badges';
import { AvisoBloqueio } from '@/components/veiculos/aviso-bloqueio';
import { calcularConsumo, formatKmL } from '@/lib/abastecimento/consumo';
import { requireMotorista } from '@/lib/auth';
import { PRAZO_DIARIO, TIPOS_COBRANCA, inicioDaBusca, periodosCobranca, situacaoCobranca, situacaoDiaria, situacaoSemanal, type SituacaoDiaria, type SituacaoSemanal } from '@/lib/checklist/cobranca';
import { tipoLabel } from '@/lib/checklist/etapas';
import { TIMEZONE, diaDaSemana, inicioDoDia, toISODate } from '@/lib/dates';
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
  const periodos = periodosCobranca(hoje);
  const [{ data: eu }, { data: veiculos }, { data: abastecimentos }, { data: bloqueios }, { data: checklists }, { data: decisoes }] = await Promise.all([
    supabase.from('motoristas').select('id, cnh_validade').maybeSingle(),
    supabase
      .from('veiculos')
      .select('id, placa, marca, modelo, ano, km_atual, foto_geral_url, documento_url, proxima_revisao_km, proxima_revisao_data, created_at')
      .order('placa'),
    supabase
      .from('abastecimentos')
      .select('id, veiculo_id, data_abastecimento, km, litros, valor_total, preco_litro, desconto, combustivel, tanque_cheio, posto, comprovante_url, veiculos(placa)')
      .order('data_abastecimento', { ascending: false })
      .order('km', { ascending: false })
      .limit(60),
    // avaria crítica: veículo não liberado até o conserto ou a liberação do supervisor
    supabase.from('veiculo_bloqueios').select('veiculo_id, motivo, bloqueado_em, checklist_id').is('liberado_em', null),
    // cobrança: diário de hoje, semanal desde sábado e mensal do mês (checklists feitos em seu nome)
    supabase.from('checklists').select('veiculo_id, tipo, data_envio').gte('data_envio', inicioDoDia(inicioDaBusca(periodos))),
    // decisão do supervisor para hoje (veículo sem checklist diário depois das 08:30)
    supabase.from('liberacoes_diarias').select('veiculo_id, liberado, observacao').eq('dia', hoje),
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
  const cobranca = situacaoCobranca(lista.map((v) => v.id), checklists ?? [], hoje);

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
                {(() => {
                  const b = (bloqueios ?? []).find((x) => x.veiculo_id === v.id);
                  return b ? (
                    <AvisoBloqueio
                      veiculoId={v.id}
                      gestao={false}
                      bloqueio={{ motivo: b.motivo, bloqueadoEm: b.bloqueado_em, checklistId: b.checklist_id, manutencaoId: null }}
                    />
                  ) : null;
                })()}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {[v.marca, v.modelo].filter(Boolean).join(' ') || 'Veículo'}
                    {v.ano ? <span className="font-normal text-muted-foreground"> · {v.ano}</span> : null}
                  </p>
                  <AlertaBadge nivel={alerta.nivel} />
                </div>

                {(() => {
                  const situacao = cobranca.get(v.id);
                  const bloqueado = (bloqueios ?? []).some((x) => x.veiculo_id === v.id);
                  if (!situacao || bloqueado) return null;
                  const semanal = situacaoSemanal(situacao.semanal, hoje, v.created_at);
                  const decisao = (decisoes ?? []).find((d) => d.veiculo_id === v.id);
                  const diaria = situacaoDiaria(situacao.diario, decisao?.liberado ?? null);
                  return (
                    <div className="flex flex-col gap-2" aria-label="Checklists do período">
                      <AvisoRotina veiculoId={v.id} semanal={semanal} diaria={diaria} observacao={decisao?.observacao ?? null} hoje={hoje} />
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <ClipboardCheck className="size-4 text-icone" /> Checklists
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {TIPOS_COBRANCA.map((tipo) => {
                          if (situacao[tipo]) {
                            return (
                              <span key={tipo} className="flex flex-col items-center gap-0.5 rounded-xl bg-success/12 px-1 py-2 text-center text-xs font-semibold text-success-text">
                                <CircleCheck className="size-4" />
                                {tipoLabel(tipo)} feito
                              </span>
                            );
                          }
                          // semanal só no sábado ou domingo (ou atrasado): fora disso, avisa o próximo
                          if (tipo === 'semanal' && semanal === 'proximo') {
                            return (
                              <span key={tipo} className="flex flex-col items-center gap-0.5 rounded-xl bg-raised px-1 py-2 text-center text-xs font-semibold text-muted-foreground">
                                <CalendarClock className="size-4" />
                                Semanal sáb/dom
                              </span>
                            );
                          }
                          const urgente = (tipo === 'semanal' && semanal === 'atrasado') || (tipo === 'diario' && diaria === 'nao_liberado');
                          return (
                            <Link
                              key={tipo}
                              href={`/checklists/novo?veiculo=${v.id}&tipo=${tipo}`}
                              className={cn(
                                'flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center text-xs font-semibold',
                                urgente ? 'border-destructive/50 bg-destructive/10 text-destructive-text' : 'border-primary/40 bg-primary/10 text-primary',
                              )}
                            >
                              <ClipboardCheck className="size-4" />
                              Fazer {tipoLabel(tipo).toLowerCase()}
                              {tipo === 'diario' && diaria === 'aguardando' ? <span className="font-normal">até {PRAZO_DIARIO}</span> : null}
                              {tipo === 'semanal' && semanal === 'fazer' ? <span className="font-normal">até domingo</span> : null}
                              {urgente ? <span className="font-normal">não liberado</span> : null}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <dl className="grid grid-cols-2 gap-3">
                  <Indicador icone={<Gauge />} rotulo="KM atual" valor={formatKm(v.km_atual)} />
                  <Indicador icone={<BombaCombustivel />} rotulo="Seu consumo médio" valor={formatKmL(consumo)} />
                  <Indicador
                    icone={<CalendarClock />}
                    rotulo="Próxima revisão"
                    valor={v.proxima_revisao_km != null ? formatKm(v.proxima_revisao_km) : formatDateISO(v.proxima_revisao_data)}
                    detalhe={descreverAlerta(alerta, false)}
                  />
                  <Indicador
                    icone={<BombaCombustivel />}
                    rotulo="Último abastecimento"
                    valor={ultimo ? formatDateISO(ultimo.data_abastecimento) : '—'}
                    detalhe={ultimo ? formatKm(ultimo.km) : 'Nenhum lançamento'}
                  />
                </dl>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Link href={`/abastecimentos/novo?veiculo=${v.id}`} className={cn(buttonVariants({ size: 'lg' }), 'sm:flex-1')}>
                    <BombaCombustivel /> Registrar abastecimento
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

/** Aviso do dia: semanal atrasado ou não liberado pelo supervisor (vermelho), semanal do fim de semana (amarelo). */
function AvisoRotina({
  veiculoId,
  semanal,
  diaria,
  observacao,
  hoje,
}: {
  veiculoId: string;
  semanal: SituacaoSemanal;
  diaria: SituacaoDiaria;
  observacao: string | null;
  hoje: string;
}) {
  const vermelho = semanal === 'atrasado' || diaria === 'nao_liberado';
  if (!vermelho && semanal !== 'fazer') return null;
  const tipo = semanal === 'atrasado' || (semanal === 'fazer' && diaria !== 'nao_liberado') ? 'semanal' : 'diario';
  return (
    <Link
      href={`/checklists/novo?veiculo=${veiculoId}&tipo=${tipo}`}
      role={vermelho ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-2xl px-4 py-3 text-sm',
        vermelho ? 'bg-destructive/12 text-destructive-text' : 'bg-warning/15 text-warning-text',
      )}
    >
      {vermelho ? <Ban className="mt-0.5 size-5 shrink-0" /> : <TriangleAlert className="mt-0.5 size-5 shrink-0" />}
      <span>
        <strong className="block">
          {semanal === 'atrasado'
            ? 'Veículo não liberado: falta o checklist semanal'
            : diaria === 'nao_liberado'
              ? 'Não liberado hoje pelo supervisor'
              : `Hoje é dia do checklist semanal (${diaDaSemana(hoje) === 6 ? 'sábado' : 'domingo'})`}
        </strong>
        {semanal === 'atrasado'
          ? 'Era para ser feito no fim de semana. Faça agora o checklist semanal para liberar o veículo.'
          : diaria === 'nao_liberado'
            ? `Faça o checklist diário para liberar o veículo.${observacao ? ` Supervisor: ${observacao}` : ''}`
            : 'Obrigatório até domingo. Sem ele, o veículo fica não liberado a partir de segunda.'}
      </span>
    </Link>
  );
}
