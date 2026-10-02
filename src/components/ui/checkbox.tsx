import { cn } from '@/lib/utils';

/** Caixa de seleção nativa com rótulo e dica (área de toque inteira clicável). */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { label: string; hint?: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl bg-raised/60 px-3.5 py-3', className)}>
      <input type="checkbox" className="mt-0.5 size-[18px] shrink-0 accent-primary" {...props} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
