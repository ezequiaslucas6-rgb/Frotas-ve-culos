'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { liberarVeiculo } from '@/actions/veiculos';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Textarea } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';
import type { ActionState } from '@/lib/action-state';

/** o aviso some com a tela atualizada (o veículo deixa de estar bloqueado): a confirmação vai num toast */
async function liberarComAviso(prev: ActionState, formData: FormData) {
  const r = await liberarVeiculo(prev, formData);
  if (r.status === 'success') toast.success(r.message);
  return r;
}

/** Liberação pelo responsável (supervisor/admin): pede o motivo, que fica no histórico. */
export function LiberarVeiculoForm({ veiculoId }: { veiculoId: string }) {
  const { state, pending, onSubmit, fieldError } = useServerForm(liberarComAviso);
  const [aberto, setAberto] = useState(false);

  if (state.status === 'success') return <FormMessage state={state} />;
  if (!aberto) {
    return (
      <Button type="button" variant="outline" onClick={() => setAberto(true)}>
        <ShieldCheck /> Liberar veículo
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3" noValidate>
      <input type="hidden" name="veiculo_id" value={veiculoId} />
      <Field
        label="Motivo da liberação"
        htmlFor="motivo-liberacao"
        required
        error={fieldError('motivo')}
        hint="Fica registrado com o seu nome. O conserto continua pendente em Manutenções."
      >
        <Textarea id="motivo-liberacao" name="motivo" rows={2} maxLength={500} placeholder="Ex.: avaria avaliada, sem risco para rodar até a oficina." autoFocus />
      </Field>
      {/* o erro do motivo já aparece no próprio campo */}
      {!fieldError('motivo') && <FormMessage state={state} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        <SubmitButton pending={pending} pendingText="Liberando…">
          <ShieldCheck /> Confirmar liberação
        </SubmitButton>
      </div>
    </form>
  );
}
