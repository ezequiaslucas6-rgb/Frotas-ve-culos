'use client';

import { useId, useRef, useState } from 'react';

export interface Ponto {
  rotulo: string; // ex.: "mai"
  rotuloLongo: string; // ex.: "maio/2026"
  valor: number;
  /** valor já formatado para o tooltip/tabela (ex.: "R$ 1.240,00") */
  texto: string;
}

interface SparklineProps {
  pontos: Ponto[];
  /** título acessível do gráfico */
  titulo: string;
  altura?: number;
  /** cor da série (variável CSS); padrão: a cor primária */
  cor?: string;
}

const W = 600; // viewBox; o SVG escala para a largura do card
const PAD_X = 12;
const PAD_TOP = 14;

/** Linha única (uma série: o título nomeia, sem legenda) com área suave, cruz e tooltip ao passar o mouse/dedo. */
export function Sparkline({ pontos, titulo, altura = 190, cor = 'var(--primary)' }: SparklineProps) {
  const gradId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [ativo, setAtivo] = useState<number | null>(null);
  if (pontos.length === 0) return null;

  const plotH = altura - PAD_TOP - 6;
  const max = Math.max(...pontos.map((p) => p.valor), 1);
  const passo = pontos.length > 1 ? (W - PAD_X * 2) / (pontos.length - 1) : 0;
  const xy = pontos.map((p, i) => [PAD_X + i * passo, PAD_TOP + plotH - (p.valor / max) * plotH] as const);

  // curva suave (Catmull-Rom -> Bézier) sem ultrapassar muito os pontos
  const linha = xy
    .map(([x, y], i) => {
      if (i === 0) return `M${x},${y}`;
      const [x0, y0] = xy[i - 2] ?? xy[i - 1]!;
      const [x1, y1] = xy[i - 1]!;
      const [x3, y3] = xy[i + 1] ?? [x, y];
      const c1 = [x1 + (x - x0) / 6, y1 + (y - y0) / 6];
      const c2 = [x - (x3 - x1) / 6, y - (y3 - y1) / 6];
      return `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x},${y}`;
    })
    .join(' ');
  const base = PAD_TOP + plotH;
  const area = `${linha} L${xy.at(-1)![0]},${base} L${xy[0]![0]},${base} Z`;

  function mover(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round((x - PAD_X) / (passo || 1));
    setAtivo(Math.max(0, Math.min(pontos.length - 1, i)));
  }

  const p = ativo != null ? pontos[ativo] : null;
  const pos = ativo != null ? xy[ativo] : null;

  return (
    <figure className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${altura}`}
        className="h-auto w-full touch-none overflow-visible select-none"
        role="img"
        aria-label={titulo}
        onPointerMove={(e) => mover(e.clientX)}
        onPointerDown={(e) => mover(e.clientX)}
        onPointerLeave={() => setAtivo(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={cor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={cor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD_X} x2={W - PAD_X} y1={base} y2={base} stroke="var(--border)" strokeWidth="1" />
        <path d={area} fill={`url(#${gradId})`} />
        <path d={linha} fill="none" stroke={cor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {pos ? (
          <>
            <line x1={pos[0]} x2={pos[0]} y1={PAD_TOP - 6} y2={base} stroke="var(--muted-foreground)" strokeOpacity="0.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            <circle cx={pos[0]} cy={pos[1]} r="6" fill={cor} stroke="var(--card)" strokeWidth="3" />
          </>
        ) : null}
      </svg>
      {/* rótulos do eixo x em HTML: tamanho legível em qualquer largura */}
      <div className="mt-2 flex justify-between px-1 text-xs text-muted-foreground" aria-hidden>
        {pontos.map((pt) => (
          <span key={pt.rotuloLongo}>{pt.rotulo}</span>
        ))}
      </div>
      {p && pos ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-foreground px-2.5 py-1.5 text-xs whitespace-nowrap text-background"
          style={{ left: `${(pos[0] / W) * 100}%`, top: `${((pos[1] - 12) / altura) * 100}%` }}
        >
          <span className="opacity-70">{p.rotuloLongo}</span> · <strong>{p.texto}</strong>
        </div>
      ) : null}
      {/* tabela para leitores de tela; o sr-only fica num <div>: <table> ignora width e alargaria a página */}
      <div className="sr-only">
        <table>
          <caption>{titulo}</caption>
          <tbody>
            {pontos.map((pt) => (
              <tr key={pt.rotuloLongo}>
                <th scope="row">{pt.rotuloLongo}</th>
                <td>{pt.texto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
