import Link from 'next/link';
import { Ban, ClipboardCheck, Wrench } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LiberarVeiculoForm } from './liberar-veiculo-form';

interface Props {
  veiculoId: string;
  bloqueio: { motivo: string | null; bloqueadoEm: string | null; checklistId: string | null; manutencaoId: string | null } | null;
  /** manutenção aberta sem bloqueio (liberado pelo responsável): conserto pendente */
  consertoPendenteId?: string | null;
  /** supervisor/admin: mostra "Concluir manutenção" e "Liberar veículo" */
  gestao: boolean;
  className?: string;
}

/** Aviso de veículo NÃO LIBERADO (avaria crítica no checklist) ou de conserto pendente. */
export function AvisoBloqueio({ veiculoId, bloqueio, consertoPendenteId, gestao, className }: Props) {
  if (bloqueio) {
    return (
      <section role="alert" className={cn('flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4', className)}>
        <div className="flex items-start gap-3">
          <Ban className="mt-0.5 size-5 shrink-0 text-destructive-text" />
          <div className="min-w-0">
            <p className="font-semibold text-destructive-text">Veículo não liberado</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {gestao
                ? 'Avaria crítica no checklist. Libera ao concluir o conserto ou com a liberação do responsável.'
                : 'Avaria crítica no checklist. Aguarde o conserto ou a liberação do supervisor antes de rodar.'}
              {bloqueio.bloqueadoEm ? ` Desde ${formatDateTime(bloqueio.bloqueadoEm)}.` : ''}
            </p>
            {bloqueio.motivo ? <p className="mt-2 text-sm whitespace-pre-line break-words">{bloqueio.motivo}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {bloqueio.checklistId ? (
            <Link href={`/checklists/${bloqueio.checklistId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <ClipboardCheck /> Ver checklist
            </Link>
          ) : null}
          {gestao && bloqueio.manutencaoId ? (
            <Link href={`/manutencoes/${bloqueio.manutencaoId}/concluir`} className={buttonVariants({ size: 'sm' })}>
              <Wrench /> Concluir manutenção
            </Link>
          ) : null}
        </div>
        {gestao ? <LiberarVeiculoForm veiculoId={veiculoId} /> : null}
      </section>
    );
  }
  if (consertoPendenteId && gestao) {
    return (
      <section className={cn('flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between', className)}>
        <div className="flex items-start gap-3">
          <Wrench className="mt-0.5 size-5 shrink-0 text-warning-text" />
          <div>
            <p className="font-semibold text-warning-text">Conserto pendente</p>
            <p className="text-sm text-muted-foreground">O veículo foi liberado, mas a manutenção corretiva ainda está aberta.</p>
          </div>
        </div>
        <Link href={`/manutencoes/${consertoPendenteId}/concluir`} className={buttonVariants({ size: 'sm' })}>
          <Wrench /> Concluir manutenção
        </Link>
      </section>
    );
  }
  return null;
}
