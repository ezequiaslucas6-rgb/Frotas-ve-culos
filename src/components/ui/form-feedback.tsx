import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import type { ActionState } from '@/lib/action-state';
import { Button, type ButtonProps } from '@/components/ui/button';

export function FormMessage({ state }: { state: ActionState<unknown> }) {
  if (state.status === 'idle') return null;
  const isError = state.status === 'error';
  const Icon = isError ? CircleAlert : CircleCheck;
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm ${
        isError ? 'bg-destructive/15 text-destructive-text' : 'bg-success/15 text-success-text'
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{state.message}</span>
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingText = 'Salvando…',
  ...props
}: ButtonProps & { pending: boolean; pendingText?: string }) {
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? pendingText : children}
    </Button>
  );
}
