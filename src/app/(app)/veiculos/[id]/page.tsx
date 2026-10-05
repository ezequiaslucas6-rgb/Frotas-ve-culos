import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarClock, ClipboardCheck, ExternalLink, FileText, Fuel, Gauge, Pencil, Plus, Truck, UserRound, Wrench } from 'lucide-react';
import { excluirVeiculo } from '@/actions/veiculos';
import { ListaAbastecimentos } from '@/components/abastecimentos/lista-abastecimentos';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { AlertaBadge, ChecklistStatusBadge, SaudeBadge } from '@/components/ui/status-badges';
import { calcularConsumo, formatKmL } from '@/lib/abastecimento/consumo';
import { requireSession } from '@/lib/auth';
import { tipoLabel } from '@/lib/checklist/etapas';
import { formatBRL, formatDateISO, formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import { descreverAlerta } from '@/lib/maintenance/describe';
import { signedUrlMap } from '@/lib/storage';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Veículo' };

export default async function VeiculoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, isAdmin } = await requireSession();

  // tudo em paralelo (só depende do id); as URLs das imagens saem numa segunda leva, também em paralelo
  const [{ data: raw }, { data: checklists }, { data: manutencoes }, { data: abastecimentos }] = await Promise.all([
    supabase.from('vw_veiculos_painel').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('checklists')
      .select('id, data_envio, tipo, status, km_registro, motoristas(nome)')
      .eq('veiculo_id', id)
      .order('data_envio', { ascending: false })
      .limit(8),
    supabase
      .from('manutencoes')
      .select('id, tipo, descricao, custo, km_registro, data_manutencao')
      .eq('veiculo_id', id)
      .order('data_manutencao', { ascending: false })
      .limit(8),
    supabase
      .from('abastecimentos')
      .select('id, data_abastecimento, km, litros, valor_total, preco_litro, combustivel, tanque_cheio, posto, comprovante_url, motoristas(nome)')
      .eq('veiculo_id', id)
      .order('km', { ascending: false })
      .limit(30),
  ]);
  if (!raw) notFound();
  const v = { ...raw, ...avaliarVeiculoPainel(raw) };
  const consumo = calcularConsumo(abastecimentos ?? []);
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
              <SaudeBadge saude={v.saude} />
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
                  <Fuel className="size-4" /> Consumo médio
                </dt>
                <dd className="font-semibold">{formatKmL(consumo.media)}</dd>
              </div>
            </dl>
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
                      <span className="text-xs font-medium">{formatBRL(Number(m.custo))}</span>
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
              urls={urlsCupom}
              mostrarMotorista
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
