'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { criarSupervisor } from '@/actions/supervisores';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Select } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';

export function SupervisorForm({ filiais }: { filiais: Array<{ id: string; nome_cidade: string; uf: string }> }) {
  const { state, pending, onSubmit, fieldError } = useServerForm(criarSupervisor);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label="Nome" htmlFor="nome" required error={fieldError('nome')}>
        <Input id="nome" name="nome" autoComplete="off" required />
      </Field>
      <Field label="E-mail" htmlFor="email" required error={fieldError('email')}>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="off" required />
      </Field>
      <Field label="Senha provisória" htmlFor="senha" required error={fieldError('senha')} hint="Mínimo de 8 caracteres.">
        <Input id="senha" name="senha" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Filial" htmlFor="filial_id" required error={fieldError('filial_id')}>
        <Select id="filial_id" name="filial_id" required defaultValue="">
          <option value="" disabled>
            Selecione a filial…
          </option>
          {filiais.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome_cidade}/{f.uf}
            </option>
          ))}
        </Select>
      </Field>
      {state.status === 'error' ? <FormMessage state={state} /> : null}
      <SubmitButton pending={pending} pendingText="Criando…">
        Criar supervisor
      </SubmitButton>
    </form>
  );
}
