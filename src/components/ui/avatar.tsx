import { cn } from '@/lib/utils';

export const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Foto de perfil (URL assinada) ou as iniciais do nome. */
export function Avatar({ nome, url, className }: { nome: string; url?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/20 font-bold text-primary',
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        iniciais(nome)
      )}
    </span>
  );
}
