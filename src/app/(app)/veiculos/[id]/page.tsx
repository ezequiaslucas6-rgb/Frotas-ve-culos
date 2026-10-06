import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Ban, CalendarClock, ClipboardCheck, ExternalLink, FileText, Gauge, Pencil, Plus, TriangleAlert, Truck, UserRound, Wrench } from 'lucide-react';
import { BombaCombustivel } from '@/components/icones/bomba-combustivel';
import { excluirVeiculo } from '@/actions/veiculos';
import { ListaAbastecimentos } from '@/components/abastecimentos/lista-abastecimentos';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { AlertaBadge, ChecklistStatusBadge, SaudeBadge } from '@/components/ui/status-badges';
import { DecisaoDiaria } from '@/components/painel/decisao-diaria';
import { AvisoBloqueio } from '@/components/veiculos/aviso-bloqueio';
import { calcularConsumo, descreverAnomalia, detectarConsumoAnormal, dicaAnomalia, formatKmL } from '@/lib/abastecimento/consumo';
import { requireSession } from '@/lib/auth';
import { tipoLabel } from '@/lib/checklist/etapas';
import { formatBRL, formatDateISO, formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import { descreverAlerta } from '@/lib/maintenance/describe';
import { signedUrlMap } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Veículo' };

export default async function VeiculoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, isAdmin } = await requireSession();

  // tudo em paralelo (só depende do id); as URLs das imagens saem numa segunda leva, também em paralelo
  const [{ data: raw }, { data: checklists }, { data: manutencoes }, { data: abastecimentos }, { data: abertas }] = await Promise.all([
    supabase.from('vw_veiculos_painel').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('checklists')
      .select('id, data_envio, tipo, status, km_registro, motoristas(nome)')
      .eq('veiculo_id', id)
      .order('data_envio', { ascending: false })
      .limit(8),
    supabase
      .from('manutencoes')
      .select('id, tipo, descricao, custo, km_registro, data_manutencao, situacao')
      .eq('veiculo_id', id)
      .order('data_manutencao', { ascending: false })
      .limit(8),
    supabase
      .from('abastecimentos')
      .select('id, data_abastecimento, km, litros, valor_total, preco_litro, desconto, combustivel, tanque_cheio, posto, comprovante_url, motoristas(nome)')
      .eq('veiculo_id', id)
      .order('km', { ascending: false })
      .limit(30),
    // conserto pendente: a manutenção aberta mais antiga (normalmente a da avaria do checklist)
    supabase.from('manutencoes').select('id').eq('veiculo_id', id).eq('situacao', 'aberta').order('created_at').limit(1),
  ]);
  if (!raw) notFound();
  const v = { ...raw, ...avaliarVeiculoPainel(raw) };
  const consertoPendente = abertas?.[0]?.id ?? null;
  const consumo = calcularConsumo(abastecimentos ?? []);
  const anomalias = detectarConsumoAnormal(abastecimentos ?? []);
  const [urls, urlsCupom] = await Promise.all([
    signedUrlMap(supabase, 'veiculos', [raw.foto_geral_url, raw.documento_url]),
    signedUrlMap(supabase, 'abastecimentos', (abastecimentos ?? []).slice(0, 6).map((a) => a.comprovante_url)),
  ]);

  const fotoUrl = raw.foto_geral_url ? urls[raw.foto_geral_url] : undefined;
  const docUrl = raw.documento_url ? urls[raw.documento_url] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={formatPlaca(v.placa)}
        description={`${[v.marca, v.modelo, v.ano].filter(Boolean).join(' ') || 'Sem modelo informado'} · ${formatFilial(v)}`}
        actions={
          <>
            <Link href={`/checklists/novo?veiculo=${v.id}`} className={buttonVariants()}>
              <ClipboardCheck /> Novo checklist
            </Link>
            <Link href={`/manutencoes/nova?veiculo=${v.id}`} className={buttonVariants({ variant: 'outline' })}>
              <Wrench /> Registrar manutenção
            </Link>
            <Link href={`/veiculos/${v.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil /> Editar
            </Link>
            {isAdmin ? (
              <DeleteButton
                action={excluirVeiculo}
                id={v.id}
                label="Excluir"
                confirmMessage={`Excluir o veículo ${formatPlaca(v.placa)}? Esta ação não pode ser desfeita.`}
              />
            ) : null}
          </>
        }
      />

      <AvisoBloqueio
        veiculoId={v.id}
        gestao
        bloqueio={
          v.bloqueio_id
            ? { motivo: v.bloqueio_motivo, bloqueadoEm: v.bloqueado_em, checklistId: v.bloqueio_checklist_id, manutencaoId: v.bloqueio_manutencao_id }
            : null
        }
        consertoPendenteId={consertoPendente}
      />

      {v.bloqueio === 'semanal' || v.bloqueio === 'diario' || v.semanal === 'fazer' || v.diaria === 'decidir' ? (
        <section
          role={v.naoLiberado ? 'alert' : 'status'}
          className={cn(
            'flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between',
            v.naoLiberado ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10',
          )}
        >
          <div className="flex items-start gap-3">
            {v.naoLiberado ? <Ban className="mt-0.5 size-5 shrink-0 text-destructive-text" /> : <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" />}
            <div>
              <p className={cn('font-semibold', v.naoLiberado ? 'text-destructive-text' : 'text-warning-text')}>
                {v.bloqueio === 'semanal'
                  ? 'Não liberado: checklist semanal do fim de semana não feito'
                  : v.bloqueio === 'diario'
                    ? 'Não liberado hoje: sem checklist diário'
                    : v.diaria === 'decidir'
                      ? 'Sem checklist diário depois das 08:30'
                      : 'Checklist semanal: fazer até domingo'}
              </p>
              <p className="text-sm text-muted-foreground">
                {v.bloqueio === 'semanal'
                  ? 'Libera assim que o checklist semanal for feito.'
                  : v.bloqueio === 'diario'
                    ? `Libera com o checklist diário ou com a sua decisão.${v.liberacao_diaria_obs ? ` Observação: ${v.liberacao_diaria_obs}` : ''}`
                    : v.diaria === 'decidir'
                      ? 'Decida se o veículo está liberado para uso hoje.'
                      : 'Obrigatório no sábado ou domingo; sem ele, o veículo fica não liberado na segunda.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/checklists/novo?veiculo=${v.id}&tipo=${v.bloqueio === 'semanal' || v.semanal === 'fazer' ? 'semanal' : 'diario'}`}
              className={buttonVariants({ size: 'sm' })}
            >
              <ClipboardCheck /> Fazer checklist
            </Link>
            {v.diaria === 'decidir' || v.bloqueio === 'diario' ? <DecisaoDiaria veiculoId={v.id} decisao={v.liberacao_diaria} /> : null}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="overflow-hidden py-0">
          <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground">
            {fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotoUrl} alt={`Foto geral de ${v.placa}`} className="size-full object-cover" />
            ) : (
              <Truck className="size-14" />
            )}
          </div>
          {docUrl ? (
            <div className="border-t p-3">
              <a href={docUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <FileText /> Documento do veículo <ExternalLink />
              </a>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Situação</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <SaudeBadge saude={v.saude} naoLiberado={v.naoLiberado} />
              <AlertaBadge nivel={v.alerta.nivel} />
            </div>
            {v.motivos.length > 0 ? (
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {v.motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <Gauge className="size-4" /> KM atual
                </dt>
                <dd className="text-lg font-semibold">{formatKm(v.km_atual)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <CalendarClock className="size-4" /> Próxima revisão
                </dt>
                <dd className="font-semibold">
                  {v.proxima_revisao_km != null ? formatKm(v.proxima_revisao_km) : '—'}
                  <span className="block text-sm font-normal text-muted-foreground">{formatDateISO(v.proxima_revisao_data)}</span>
                </dd>
              </div>
              <div className="col-span-2 text-muted-foreground">
                {v.proxima_revisao_km != null || v.proxima_revisao_data ? descreverAlerta(v.alerta, false) : 'Sem plano de revisão'}
                {` · revisão a cada ${formatKm(v.intervalo_revisao_km)} ou ${v.intervalo_revisao_dias} dias`}
              </div>
              <div>
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <UserRound className="size-4" /> Motorista responsável
                </dt>
                <dd className="font-semibold">
                  {v.motorista_id ? (
                    <Link href={`/motoristas/${v.motorista_id}`} className="hover:text-primary hover:underline">
                      {v.motorista_nome}
                    </Link>
                  ) : (
                    <span className="font-normal text-muted-foreground">Não definido</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-muted-foreground">
                  <BombaCombustivel className="size-4" /> Consumo médio
                </dt>
                <dd className="font-semibold">{formatKmL(consumo.media)}</dd>
                <dd className="text-xs text-muted-foreground">Tanque cheio a tanque cheio, só com o KM dos abastecimentos</dd>
              </div>
            </dl>
            {anomalias.ultima ? (
              <p role="status" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
                <strong>Consumo fora do padrão:</strong> {formatKmL(anomalias.ultima.kml)} no último tanque, {descreverAnomalia(anomalias.ultima)} (
                {formatKmL(anomalias.ultima.referencia)}). {dicaAnomalia(anomalias.ultima)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Checklists recentes</CardTitle>
            <Link href={`/checklists/novo?veiculo=${v.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <Plus /> Novo
            </Link>
          </CardHeader>
          <CardContent>
            {(checklists ?? []).length === 0 ? (
              <EmptyState title="Nenhum checklist registrado" />
            ) : (
              <ul className="divide-y">
                {(checklists ?? []).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                    <Link href={`/checklists/${c.id}`} className="min-w-0 hover:underline">
                      <span className="font-medium">{formatDateTime(c.data_envio)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {tipoLabel(c.tipo)} · {c.motoristas?.nome ?? '—'}
                        {c.km_registro != null ? ` · ${formatKm(c.km_registro)}` : ''}
                      </span>
                    </Link>
                    <ChecklistStatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Manutenções</CardTitle>
            <Link href={`/manutencoes/nova?veiculo=${v.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <Plus /> Nova
            </Link>
          </CardHeader>
          <CardContent>
            {(manutencoes ?? []).length === 0 ? (
              <EmptyState title="Nenhuma manutenção registrada" />
            ) : (
              <ul className="divide-y">
                {(manutencoes ?? []).map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium">{m.descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateISO(m.data_manutencao)} · {formatKm(m.km_registro)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={m.tipo === 'preventiva' ? 'secondary' : 'warning'}>
                        {m.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}
                      </Badge>
                      {m.situacao === 'aberta' ? (
                        <Link href={`/manutencoes/${m.id}/concluir`} className="text-xs font-semibold text-primary hover:underline">
                          Aberta · concluir
                        </Link>
                      ) : (
                        <span className="text-xs font-medium">{formatBRL(Number(m.custo))}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-y-1">
          <CardTitle>Abastecimentos</CardTitle>
          <div className="flex flex-wrap gap-1">
            <Link href={`/abastecimentos?veiculo=${v.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Ver todos
            </Link>
            <Link href={`/abastecimentos/novo?veiculo=${v.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <Plus /> Novo
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {(abastecimentos ?? []).length === 0 ? (
            <EmptyState title="Nenhum abastecimento lançado" />
          ) : (
            <ListaAbastecimentos
              itens={(abastecimentos ?? []).slice(0, 6)}
              consumo={consumo.porLancamento}
              anomalias={anomalias.porLancamento}
              urls={urlsCupom}
              mostrarMotorista
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
