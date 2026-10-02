'use client';

import { Truck } from 'lucide-react';
import { signIn } from '@/actions/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';

export function LoginForm({ next }: { next?: string }) {
  const { state, pending, onSubmit } = useServerForm(signIn);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <span className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Truck className="size-6" />
        </span>
        <CardTitle className="text-xl">Gestão de Frotas</CardTitle>
        <CardDescription>Entre com seu e-mail e senha</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Field label="E-mail" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
          </Field>
          <Field label="Senha" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <FormMessage state={state} />
          <SubmitButton pending={pending} pendingText="Entrando…" size="lg">
            Entrar
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
