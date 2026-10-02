'use client';

import { startTransition, useActionState, useCallback, type FormEvent } from 'react';
import { idle, type ActionState } from '@/lib/action-state';

/**
 * Formulário ligado a uma Server Action SEM usar <form action>.
 * Motivo: no React 19, <form action> reseta os campos não controlados ao final da
 * action — inclusive quando ela devolve erro de validação, o que apagaria tudo o que
 * o usuário digitou. Com onSubmit + startTransition os valores são preservados.
 */
export function useServerForm<T = undefined>(action: (prev: ActionState<T>, formData: FormData) => Promise<ActionState<T>>) {
  const [state, formAction, pending] = useActionState<ActionState<T>, FormData>(action, idle as ActionState<T>);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      startTransition(() => formAction(formData));
    },
    [formAction],
  );

  const fieldError = (name: string) => (state.status === 'error' ? state.fieldErrors?.[name]?.[0] : undefined);

  return { state, pending, onSubmit, fieldError };
}
