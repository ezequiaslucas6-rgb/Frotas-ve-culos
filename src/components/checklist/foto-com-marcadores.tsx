import type { Json } from '@/types/database';
import type { MarcadorAvaria } from '@/lib/checklist/etapas';

export function parseMarcadores(value: Json): MarcadorAvaria[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.x === 'number' && typeof item.y === 'number') {
      return [{ x: item.x, y: item.y }];
    }
    return [];
  });
}

/** Foto com os pins de avaria sobrepostos (posição em % da imagem). */
export function FotoComMarcadores({ src, alt, marcadores }: { src: string; alt: string; marcadores: MarcadorAvaria[] }) {
  return (
    <div className="relative w-fit max-w-full overflow-hidden rounded-lg bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" className="block max-h-80 w-auto max-w-full" />
      {marcadores.map((m, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-destructive text-[11px] font-bold text-white shadow"
          style={{ left: `${m.x}%`, top: `${m.y}%` }}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}
