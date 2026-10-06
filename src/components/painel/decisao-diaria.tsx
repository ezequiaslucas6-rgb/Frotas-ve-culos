'use client';

import { useState, useTransition } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { decidirLiberacaoDiaria } from '@/actions/veiculos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Liberar ou não um veículo que está sem o checklist diário (depois das 08:30). A decisão
 * pode ser trocada no mesmo dia; "não liberado" vale até o veículo fazer o checklist.
 */
export function DecisaoDiaria({ veiculoId, decisao, className }: { veiculoId: string; decisao: boolean | null; className?: string }) {
  const [pendente, iniciar] = useTransition();
  const [obs, setObs] = useState('');
  const [observando, setObservando] = useState(false);

  const decidir = (liberado: boolean) =>
    iniciar(async () => {
      const r = await decidirLiberacaoDiaria({ veiculoId, liberado, observacao: obs.trim() || undefined });
      if (r.status === 'success') {
        toast.success(r.message);
        setObservando(false);
      } else if (r.status === 'error') toast.error(r.message);
    });

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {observando ? (
        <Input
          aria-label="Observação da decisão"
          placeholder="Observação (opcional): ex.: motorista avisou que faz às 10h"
          maxLength={300}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          className="h-9 text-sm"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={decisao === true ? 'default' : 'outline'} disabled={pendente} onClick={() => decidir(true)}>
          <ShieldCheck /> Liberar
        </Button>
        <Button
          type="button"
          size="sm"
          variant={decisao === false ? 'destructive' : 'outline'}
          disabled={pendente}
          onClick={() => decidir(false)}
        >
          <Ban /> Não liberar
        </Button>
        {!observando ? (
          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setObservando(true)}>
            + observação
          </button>
        ) : null}
      </div>
    </div>
  );
}
