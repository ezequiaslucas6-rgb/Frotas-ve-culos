'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { salvarFilial } from '@/actions/filiais';
import { buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';
import type { Tables } from '@/types/database';

export function FilialForm({ filial }: { filial?: Tables<'filiais'> }) {
  const { state, pending, onSubmit, fieldError } = useServerForm(salvarFilial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {filial ? <input type="hidden" name="id" value={filial.id} /> : null}
      <Field label="Cidade" htmlFor="nome_cidade" required error={fieldError('nome_cidade')}>
        <Input id="nome_cidade" name="nome_cidade" defaultValue={filial?.nome_cidade} required />
      </Field>
      <Field label="UF" htmlFor="uf" required error={fieldError('uf')}>
        <Input id="uf" name="uf" defaultValue={filial?.uf} maxLength={2} className="uppercase" required />
      </Field>
      {state.status === 'error' ? <FormMessage state={state} /> : null}
      <div className="flex gap-2">
        <SubmitButton pending={pending}>{filial ? 'Salvar' : 'Adicionar filial'}</SubmitButton>
        {filial ? (
          <Link href="/filiais" className={buttonVariants({ variant: 'outline' })}>
            Cancelar
          </Link>
        ) : null}
      </div>
    </form>
  );
}
