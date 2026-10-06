import type { Metadata } from 'next';
import Link from 'next/link';
import { Ban, CalendarCheck, CircleCheck, Clock, ClipboardCheck, ShieldCheck, TriangleAlert } from 'lucide-react';
import { DecisaoDiaria } from '@/components/painel/decisao-diaria';
import { FilialFilter } from '@/components/filial-filter';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { ChecklistStatusBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { PRAZO_DIARIO, diasDoSemanal, ehFimDeSemana, type SituacaoDiaria } from '@/lib/checklist/cobranca';
import { horaLocal, toISODate } from '@/lib/dates';
import { formatDateISO, formatDateTime, formatFilial } from '@/lib/format';
import { avaliarVeiculoPainel } from '@/lib/maintenance/alerts';
import { resolveFilialFilter, type SearchParams } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { formatPlaca } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Checklist de hoje' };

const diaPorExtenso = (dia: string) => {
  const texto = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${dia}T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** Ordem na lista do diário: o que pede ação primeiro. */
const ORDEM: Record<SituacaoDiaria, number> = { decidir: 0, nao_liberado: 1, aguardando: 2, liberado: 3, feito: 4 };

/**
 * Rotina do supervisor: às 08:30 (horário de Pimenta Bueno) vê quais veículos fizeram o
 * checklist diário e decide, para os que não fizeram, se estão liberados para uso hoje.
 * Também mostra o semanal (obrigatório no sábado ou domingo).
 */
export default async function ChecklistDeHojePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin } = session;
  const filialId = resolveFilialFilter(session, sp);
  const agora = new Date();
  const hoje = toISODate(agora);
  const hora = horaLocal(agora);
  const passouPrazo = hora >= PRAZO_DIARIO;

  let veiculosQ = supabase.from('vw_veiculos_painel').select('*').order('placa');
  if (filialId) veiculosQ = veiculosQ.eq('filial_id', filialId);
  const [{ data }, { data: filiais }] = await Promise.all([
    veiculosQ,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);

  const veiculos = (data ?? []).map((v) => ({ ...v, ...avaliarVeiculoPainel(v, hoje, agora) }));
  // parados por avaria (aguardando conserto) ficam fora da rotina
  const operando = veiculos.filter((v) => v.bloqueio !== 'avaria');
  const parados = veiculos.length - operando.length;
  const diario = [...operando].sort((a, b) => ORDEM[a.diaria] - ORDEM[b.diaria] || a.placa.localeCompare(b.placa));
  const conta = (s: SituacaoDiaria) => operando.filter((v) => v.diaria === s).length;
  const feitos = conta('feito');
  const aDecidir = conta('decidir');

  const fimDeSemana = ehFimDeSemana(hoje);
  const { sabado, domingo } = diasDoSemanal(hoje);
  const semanalPendentes = operando.filter((v) => v.semanal === 'fazer' || v.semanal === 'atrasado');
  const semanalFeitos = operando.filter((v) => v.semanal === 'feito').length;
  // antes do 1º fim de semana da regra (ou veículo novo) ninguém está em falta
  const semanalEmDia = operando.length - semanalPendentes.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Checklist de hoje"
        description={`${diaPorExtenso(hoje)} · agora ${hora} (horário de Pimenta Bueno)`}
        actions={isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
      />

      <p
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-2xl px-4 py-3 text-sm',
          passouPrazo && aDecidir > 0 ? 'bg-warning/15 text-warning-text' : 'bg-primary/10 text-foreground',
        )}
      >
        {passouPrazo && aDecidir > 0 ? <TriangleAlert className="mt-0.5 size-5 shrink-0" /> : <Clock className="mt-0.5 size-5 shrink-0 text-icone" />}
        <span>
          {!passouPrazo
            ? `O checklist diário não é obrigatório: os motoristas fazem até as ${PRAZO_DIARIO}. Depois disso, decida aqui se cada veículo sem checklist está liberado para uso hoje.`
            : aDecidir > 0
              ? `Passou das ${PRAZO_DIARIO}: ${aDecidir} veículo(s) sem checklist diário aguardam a sua decisão.`
              : `Passou das ${PRAZO_DIARIO}: todos os veículos fizeram o checklist ou já têm a sua decisão.`}
        </span>
      </p>

      <Card className="px-0">
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Diário</CardTitle>
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground">{feitos}</strong> de {operando.length} feitos
          </span>
        </CardHeader>
        <CardContent>
          {diario.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="Nenhum veículo em operação" />
          ) : (
            <ul className="divide-y divide-border/60">
              {diario.map((v) => (
                <li key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/veiculos/${v.id}`} className="font-semibold hover:underline">
                        {formatPlaca(v.placa)}
                      </Link>
                      <SituacaoBadge situacao={v.diaria} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[v.modelo, v.motorista_nome ?? 'sem motorista', isAdmin && !filialId ? formatFilial(v) : null].filter(Boolean).join(' · ')}
                    </p>
                    {v.diaria === 'feito' && v.ultimo_checklist_id ? (
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Link href={`/checklists/${v.ultimo_checklist_id}`} className="font-medium text-primary hover:underline">
                          Feito {formatDateTime(v.ultimo_checklist_em).slice(-5)}
                        </Link>
                        {v.ultimo_checklist_status ? <ChecklistStatusBadge status={v.ultimo_checklist_status} /> : null}
                      </p>
                    ) : null}
                    {(v.diaria === 'liberado' || v.diaria === 'nao_liberado') && v.liberacao_diaria_em ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Decidido às {formatDateTime(v.liberacao_diaria_em).slice(-5)}
                        {v.liberacao_diaria_obs ? ` · ${v.liberacao_diaria_obs}` : ''}
                      </p>
                    ) : null}
                  </div>
                  {v.diaria !== 'feito' ? (
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Link href={`/checklists/novo?veiculo=${v.id}&tipo=diario`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        <ClipboardCheck /> Fazer
                      </Link>
                      <DecisaoDiaria veiculoId={v.id} decisao={v.liberacao_diaria} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {parados > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{parados} veículo(s) parado(s) por avaria, aguardando conserto, fora da rotina.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="px-0">
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Semanal (obrigatório)</CardTitle>
          <span className="text-sm text-muted-foreground">
            {fimDeSemana ? `Hoje é dia: sábado ${formatDateISO(sabado).slice(0, 5)} e domingo ${formatDateISO(domingo).slice(0, 5)}` : `Próximo: sábado ${formatDateISO(sabado).slice(0, 5)} e domingo ${formatDateISO(domingo).slice(0, 5)}`}
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Feito no sábado ou no domingo. Sem ele, o veículo fica <strong className="text-destructive-text">não liberado</strong> de segunda
            em diante, até fazer. {semanalEmDia} de {operando.length} em dia ({semanalFeitos} já fizeram neste ciclo).
          </p>
          {semanalPendentes.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success-text">
              <CircleCheck className="size-4" /> Todos em dia
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Semanal pendente">
              {semanalPendentes.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/checklists/novo?veiculo=${v.id}&tipo=semanal`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary hover:text-primary',
                      v.semanal === 'atrasado' ? 'border-destructive/50 bg-destructive/10 text-destructive-text' : 'border-border bg-card',
                    )}
                  >
                    {v.semanal === 'atrasado' ? <Ban className="size-3.5" /> : <ClipboardCheck className="size-3.5" />}
                    {formatPlaca(v.placa)}
                    {v.semanal === 'atrasado' ? ' · atrasado' : ''}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SituacaoBadge({ situacao }: { situacao: SituacaoDiaria }) {
  switch (situacao) {
    case 'feito':
      return (
        <Badge variant="success">
          <CircleCheck /> Feito
        </Badge>
      );
    case 'aguardando':
      return (
        <Badge variant="secondary">
          <Clock /> Até {PRAZO_DIARIO}
        </Badge>
      );
    case 'decidir':
      return (
        <Badge variant="warning">
          <TriangleAlert /> Sem checklist: decidir
        </Badge>
      );
    case 'liberado':
      return (
        <Badge variant="default">
          <ShieldCheck /> Liberado sem checklist
        </Badge>
      );
    case 'nao_liberado':
      return (
        <Badge variant="danger">
          <Ban /> Não liberado hoje
        </Badge>
      );
  }
}
