'use client';

import Link from 'next/link';
import { concluirManutencao } from '@/actions/manutencoes';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Textarea } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';

export function ConcluirManutencaoForm({ id, veiculoId, descricao, km, hoje }: { id: string; veiculoId: string; descricao: string; km: number; hoje: string }) {
  const { state, pending, onSubmit, fieldError } = useServerForm(concluirManutencao);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="id" value={id} />
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Data do conserto" htmlFor="data_manutencao" required error={fieldError('data_manutencao')}>
            <Input id="data_manutencao" name="data_manutencao" type="date" defaultValue={hoje} max={hoje} required />
          </Field>
          <Field label="KM no serviço" htmlFor="km_registro" required error={fieldError('km_registro')}>
            <Input id="km_registro" name="km_registro" type="number" inputMode="numeric" min={0} defaultValue={km} required />
          </Field>
          <Field label="Custo (R$)" htmlFor="custo" required error={fieldError('custo')}>
            <Input id="custo" name="custo" inputMode="decimal" placeholder="0,00" required />
          </Field>
          <Field label="Oficina / fornecedor" htmlFor="fornecedor" error={fieldError('fornecedor')}>
            <Input id="fornecedor" name="fornecedor" />
          </Field>
          <Field label="Serviço realizado" htmlFor="descricao" required error={fieldError('descricao')} className="sm:col-span-2" hint="Já vem com a avaria apontada no checklist; complete com o que foi feito.">
            <Textarea id="descricao" name="descricao" rows={5} required defaultValue={descricao} />
          </Field>
        </CardContent>
      </Card>
      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={`/veiculos/${veiculoId}`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Cancelar
        </Link>
        <SubmitButton pending={pending} pendingText="Concluindo…" size="lg">
          Concluir e liberar o veículo
        </SubmitButton>
      </div>
    </form>
  );
}
