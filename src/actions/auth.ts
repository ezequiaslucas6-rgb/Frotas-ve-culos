'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { fail, type ActionState } from '@/lib/action-state';
import { getSession } from '@/lib/auth';
import { formDataToObject } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Informe um e-mail válido.')),
  password: z.string().min(1, 'Informe a senha.'),
  next: z.string().optional(),
});

/** Só aceita redirecionamentos internos (evita open redirect). */
const safeNext = (next?: string) => (next && /^\/(?!\/)/.test(next) && !next.startsWith('/login') ? next : '/dashboard');

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail('Informe e-mail e senha válidos.');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return fail('E-mail ou senha inválidos.');

  // Usuário do Auth sem perfil (profiles) não tem acesso ao sistema.
  if (!(await getSession())) {
    await supabase.auth.signOut();
    return fail('Seu usuário ainda não foi habilitado. Fale com o administrador.');
  }

  redirect(safeNext(parsed.data.next));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
