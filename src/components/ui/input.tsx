import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputClasses =
  'flex h-11 w-full min-w-0 rounded-xl border border-transparent bg-raised px-3.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground/80 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:border-primary/70 focus-visible:ring-[3px] focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(inputClasses, className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClasses, 'h-auto min-h-20 resize-y', className)} {...props} />;
}

/** <select> nativo: melhor UX em celular/WebView (seletor do sistema) do que um dropdown custom. */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(inputClasses, 'appearance-none bg-size-[1rem] bg-position-[right_0.75rem_center] bg-no-repeat pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-[13px] leading-none font-medium text-muted-foreground select-none', className)} {...props} />;
}

export { Input, Textarea, Select, Label };
