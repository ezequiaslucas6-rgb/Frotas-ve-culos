'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface Fatia {
  chave: string;
  rotulo: string;
  valor: number;
  cor: string; // token CSS, ex.: var(--success)
  icone: React.ReactNode;
}

const R = 70;
const ESPESSURA = 16;
const CIRC = 2 * Math.PI * R;
const GAP = 3; // separação entre segmentos (na cor do card)

/** Anel de composição (status da frota). Identidade nunca só pela cor: legenda com ícone + rótulo + número. */
export function Donut({ fatias, totalRotulo }: { fatias: Fatia[]; totalRotulo: string }) {
  const [ativa, setAtiva] = useState<string | null>(null);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const visiveis = fatias.filter((f) => f.valor > 0);
  const destaque = fatias.find((f) => f.chave === ativa);

  const fracoes = visiveis.map((f) => f.valor / (total || 1));
  const arcos = visiveis.map((f, i) => ({
    f,
    comprimento: Math.max(fracoes[i]! * CIRC - (visiveis.length > 1 ? GAP : 0), 0.5),
    offset: -fracoes.slice(0, i).reduce((s, x) => s + x, 0) * CIRC,
  }));

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative size-[180px]">
        <svg viewBox="0 0 180 180" className="size-full -rotate-90" role="img" aria-label={`${totalRotulo}: ${total}`}>
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--raised)" strokeWidth={ESPESSURA} />
          {arcos.map(({ f, comprimento, offset }) => (
            <circle
              key={f.chave}
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={f.cor}
              strokeWidth={ativa === f.chave ? ESPESSURA + 4 : ESPESSURA}
              strokeDasharray={`${comprimento} ${CIRC}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              className="cursor-pointer transition-[stroke-width]"
              onPointerEnter={() => setAtiva(f.chave)}
              onPointerLeave={() => setAtiva(null)}
            >
              <title>{`${f.rotulo}: ${f.valor}`}</title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-bold tracking-tight">{destaque ? destaque.valor : total}</span>
          <span className="max-w-[110px] text-xs text-muted-foreground">{destaque ? destaque.rotulo : totalRotulo}</span>
        </div>
      </div>
      <ul className="grid w-full gap-2">
        {fatias.map((f) => (
          <li
            key={f.chave}
            onPointerEnter={() => setAtiva(f.chave)}
            onPointerLeave={() => setAtiva(null)}
            className={cn('flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm transition-colors', ativa === f.chave && 'bg-raised')}
          >
            <span className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-lg [&_svg]:size-4" style={{ color: f.cor, background: `color-mix(in oklab, ${f.cor} 16%, transparent)` }}>
                {f.icone}
              </span>
              {f.rotulo}
            </span>
            <span className="font-semibold">
              {f.valor}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{total ? Math.round((f.valor / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
