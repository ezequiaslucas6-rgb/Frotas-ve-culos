'use client';

import { startTransition, useActionState, useEffect } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { idle, type ActionState } from '@/lib/action-state';
import { Button } from '@/components/ui/button';

interface DeleteButtonProps {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  id: string;
  confirmMessage: string;
  label?: string;
  size?: 'sm' | 'default' | 'icon';
}

/** Exclusão com confirmação; erros (ex.: registros vinculados) aparecem como toast. */
export function DeleteButton({ action, id, confirmMessage, label = 'Excluir', size = 'sm' }: DeleteButtonProps) {
  const [state, formAction, pending] = useActionState(action, idle);

  useEffect(() => {
    if (state.status === 'error') toast.error(state.message);
    if (state.status === 'success') toast.success(state.message);
  }, [state]);

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      disabled={pending}
      aria-label={label}
      title={label}
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() => {
        if (!window.confirm(confirmMessage)) return;
        const formData = new FormData();
        formData.set('id', id);
        startTransition(() => formAction(formData));
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      {size === 'icon' ? null : label}
    </Button>
  );
}
