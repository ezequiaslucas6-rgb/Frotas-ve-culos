'use client';

import { Truck } from 'lucide-react';
import { signIn } from '@/actions/auth';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';

export function LoginForm({ next }: { next?: string }) {
  const { state, pending, onSubmit } = useServerForm(signIn);

  return (
    <div className="w-full max-w-sm">
      <span className="mb-8 flex size-12 items-center justify-center rounded-2xl bg-rail text-white md:hidden">
        <Truck className="size-6" strokeWidth={2.4} />
      </span>
      <h2 className="text-2xl font-bold tracking-tight">Entrar</h2>
      <p className="mt-1 text-sm text-muted-foreground">Use o e-mail e a senha cadastrados pelo administrador.</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton pending={pending} pendingText="Entrando…" size="lg" className="mt-1">
          Entrar
        </SubmitButton>
      </form>
    </div>
  );
}
