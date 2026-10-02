'use client';

import Link from 'next/link';
import { salvarMotorista } from '@/actions/motoristas';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Select } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import { useServerForm } from '@/hooks/use-server-form';
import type { Tables } from '@/types/database';

interface MotoristaFormProps {
  filiais: Array<{ id: string; nome_cidade: string; uf: string }> | null;
  motorista?: Tables<'motoristas'>;
}

export function MotoristaForm({ filiais, motorista }: MotoristaFormProps) {
  const { state, pending, onSubmit, fieldError } = useServerForm(salvarMotorista);
  const editing = Boolean(motorista);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {motorista ? <input type="hidden" name="id" value={motorista.id} /> : null}
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {filiais && !editing ? (
            <Field label="Filial" htmlFor="filial_id" required error={fieldError('filial_id')} className="sm:col-span-2">
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
          ) : null}
          <Field label="Nome completo" htmlFor="nome" required error={fieldError('nome')} className="sm:col-span-2">
            <Input id="nome" name="nome" defaultValue={motorista?.nome} autoComplete="name" required aria-invalid={!!fieldError('nome')} />
          </Field>
          <Field label="CPF" htmlFor="cpf" required error={fieldError('cpf')}>
            <MaskedInput id="cpf" name="cpf" mask="cpf" defaultValue={motorista?.cpf} required aria-invalid={!!fieldError('cpf')} />
          </Field>
          <Field label="CNH" htmlFor="cnh" required error={fieldError('cnh')} hint="11 dígitos">
            <MaskedInput id="cnh" name="cnh" mask="cnh" defaultValue={motorista?.cnh} required aria-invalid={!!fieldError('cnh')} />
          </Field>
          <Field label="E-mail" htmlFor="email" required error={fieldError('email')}>
            <Input id="email" name="email" type="email" inputMode="email" defaultValue={motorista?.email} required aria-invalid={!!fieldError('email')} />
          </Field>
          <Field label="WhatsApp" htmlFor="whatsapp" required error={fieldError('whatsapp')} hint="Com DDD">
            <MaskedInput id="whatsapp" name="whatsapp" mask="whatsapp" defaultValue={motorista?.whatsapp} required aria-invalid={!!fieldError('whatsapp')} />
          </Field>
          <Field label="Status" htmlFor="status" error={fieldError('status')}>
            <Select id="status" name="status" defaultValue={motorista?.status ?? 'ativo'}>
              <option value="ativo">Ativo</option>
              <option value="ferias">Férias</option>
              <option value="afastado">Afastado</option>
              <option value="inativo">Inativo</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/motoristas" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Cancelar
        </Link>
        <SubmitButton pending={pending} size="lg">
          {editing ? 'Salvar alterações' : 'Cadastrar motorista'}
        </SubmitButton>
      </div>
    </form>
  );
}
