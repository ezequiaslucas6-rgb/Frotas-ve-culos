import Link from 'next/link';
import { ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { PRAZO_DIARIO, TIPOS_COBRANCA, type PeriodosCobranca, type resumoCobranca } from '@/lib/checklist/cobranca';
import { tipoLabel } from '@/lib/checklist/etapas';
import { cn } from '@/lib/utils';
import { formatPlaca } from '@/lib/validators/documentos';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MAX_PLACAS = 8;

/**
 * Quadro "Checklists": diário de hoje (até 08:30, não obrigatório), semanal do ciclo
 * (sábado ou domingo, obrigatório) e mensal do mês.
 */
export function CobrancaChecklists({
  resumo,
  periodos,
  foraDaCobranca,
  diarioADecidir,
  semanalAtrasado,
  className,
}: {
  resumo: ReturnType<typeof resumoCobranca<{ id: string; placa: string }>>;
  periodos: PeriodosCobranca;
  /** veículos parados por avaria (aguardando conserto) */
  foraDaCobranca: number;
  /** sem checklist diário depois das 08:30 e sem decisão do supervisor */
  diarioADecidir: number;
  /** sem o semanal do fim de semana (não liberados) */
  semanalAtrasado: number;
  className?: string;
}) {
  const periodo = {
    diario: `hoje, até ${PRAZO_DIARIO}`,
    semanal: 'sáb e dom',
    mensal: MESES[Number(periodos.mensal.slice(5, 7)) - 1],
  } as const;

  return (
    <Card className={cn('gap-4 px-6 py-6', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <CardTitle>Checklists</CardTitle>
        <Link href="/checklists/hoje" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Checklist de hoje <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {diarioADecidir > 0 || semanalAtrasado > 0 ? (
        <Link href="/checklists/hoje" className="flex items-start gap-2 rounded-xl bg-warning/15 px-3 py-2.5 text-sm text-warning-text">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {[
              diarioADecidir > 0 ? `${diarioADecidir} sem checklist diário: decida se estão liberados hoje` : null,
              semanalAtrasado > 0 ? `${semanalAtrasado} não liberado(s) por falta do semanal do fim de semana` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </Link>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIPOS_COBRANCA.map((tipo) => {
          const r = resumo[tipo];
          const pct = r.total ? Math.round((r.feitos / r.total) * 100) : 100;
          return (
            <section key={tipo} aria-label={`Checklist ${tipoLabel(tipo).toLowerCase()}`} className="flex min-w-0 flex-col gap-2 rounded-xl bg-raised/50 p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {tipoLabel(tipo)}
                  {tipo === 'semanal' ? <span className="ml-1 text-xs font-normal text-destructive-text">obrigatório</span> : null}
                </p>
                <span className="text-right text-xs text-muted-foreground">{periodo[tipo]}</span>
              </div>
              <p className="text-2xl font-bold tracking-tight">
                {r.feitos}
                <span className="text-sm font-normal text-muted-foreground"> de {r.total} feitos</span>
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${tipoLabel(tipo)}: ${pct}% feitos`}>
                <div className={cn('h-full rounded-full', pct === 100 ? 'bg-success' : 'bg-icone')} style={{ width: `${pct}%` }} />
              </div>
              {r.pendentes.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs font-medium text-success-text">
                  <CircleCheck className="size-4" /> Todos em dia
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5" aria-label={`Pendentes no ${tipoLabel(tipo).toLowerCase()}`}>
                  {r.pendentes.slice(0, MAX_PLACAS).map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/checklists/novo?veiculo=${v.id}&tipo=${tipo}`}
                        className="inline-block rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold transition-colors hover:border-primary hover:text-primary"
                      >
                        {formatPlaca(v.placa)}
                      </Link>
                    </li>
                  ))}
                  {r.pendentes.length > MAX_PLACAS ? (
                    <li className="px-1 py-1 text-xs text-muted-foreground">+{r.pendentes.length - MAX_PLACAS}</li>
                  ) : null}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {foraDaCobranca > 0 ? (
        <p className="text-xs text-muted-foreground">{foraDaCobranca} veículo(s) parado(s) por avaria, aguardando conserto, fora da cobrança.</p>
      ) : null}
    </Card>
  );
}
