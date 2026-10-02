import { cn } from '@/lib/utils';

/** Placa no padrão Mercosul (faixa azul "BRASIL"), como o motorista a reconhece no veículo. */
export function Placa({ placa, className }: { placa: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex flex-col overflow-hidden rounded-md border-2 border-neutral-800 bg-white text-neutral-900 shadow-sm',
        className,
      )}
      aria-label={`Placa ${placa}`}
    >
      <span aria-hidden className="bg-[#1f4e9b] px-2 py-px text-center text-[8px] leading-tight font-bold tracking-[0.25em] text-white">
        BRASIL
      </span>
      <span className="px-3 py-0.5 font-mono text-xl leading-tight font-bold tracking-[0.12em]">{placa}</span>
    </span>
  );
}
