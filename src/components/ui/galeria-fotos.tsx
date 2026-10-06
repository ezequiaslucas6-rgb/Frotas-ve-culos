'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FotoGaleria {
  src: string;
  titulo: string;
  /** ex.: o grupo do item ("Pneus") */
  subtitulo?: string;
  observacao?: string | null;
  /** pins de avaria, em % da imagem */
  marcadores?: Array<{ x: number; y: number }>;
  /** selo ao lado do título (ex.: Conforme / Avaria) */
  selo?: ReactNode;
}

const ZOOM = 2.5;
const GaleriaContext = createContext<((indice: number) => void) | null>(null);

/**
 * Fotos que abrem ampliadas ao toque: tela cheia com os pins de avaria, anterior/próxima (setas,
 * teclado ou deslizando o dedo), zoom (toque na foto ou botão) e "Abrir original". O botão
 * voltar do celular (APK) fecha a foto em vez de sair da tela.
 */
export function GaleriaFotos({ fotos, children }: { fotos: FotoGaleria[]; children: ReactNode }) {
  const [aberta, setAberta] = useState<number | null>(null);
  const comHistorico = useRef(false);

  const abrir = useCallback((indice: number) => {
    // uma entrada no histórico: o "voltar" do celular fecha a foto (o estado do Next é mantido)
    try {
      window.history.pushState({ ...(window.history.state ?? {}), rodarGaleria: true }, '');
      comHistorico.current = true;
    } catch {
      comHistorico.current = false;
    }
    setAberta(indice);
  }, []);

  const fechar = useCallback(() => {
    if (comHistorico.current) {
      comHistorico.current = false;
      window.history.back(); // o popstate abaixo fecha
    } else {
      setAberta(null);
    }
  }, []);

  useEffect(() => {
    if (aberta === null) return;
    const aoVoltar = () => {
      comHistorico.current = false;
      setAberta(null);
    };
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, [aberta]);

  return (
    <GaleriaContext.Provider value={abrir}>
      {children}
      {aberta !== null && fotos[aberta]
        ? createPortal(<Visualizador fotos={fotos} indice={aberta} onIndice={setAberta} onFechar={fechar} />, document.body)
        : null}
    </GaleriaContext.Provider>
  );
}

/** Miniatura que abre a foto ampliada (precisa estar dentro de <GaleriaFotos>). */
export function FotoAmpliavel({ indice, titulo, className, children }: { indice: number; titulo: string; className?: string; children: ReactNode }) {
  const abrir = useContext(GaleriaContext);
  return (
    <button
      type="button"
      onClick={() => abrir?.(indice)}
      aria-label={`Ampliar foto: ${titulo}`}
      className={cn(
        // tamanho mínimo: a foto carrega conforme a rolagem e, até lá, o ícone fica dentro do espaço dela
        'group relative block min-h-24 w-fit max-w-full min-w-24 cursor-zoom-in rounded-lg bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40',
        className,
      )}
    >
      {children}
      <span aria-hidden className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow transition-transform group-hover:scale-110">
        <Maximize2 className="size-4" />
      </span>
    </button>
  );
}

function Visualizador({
  fotos,
  indice,
  onIndice,
  onFechar,
}: {
  fotos: FotoGaleria[];
  indice: number;
  onIndice: (i: number) => void;
  onFechar: () => void;
}) {
  const foto = fotos[indice]!;
  const total = fotos.length;
  const area = useRef<HTMLDivElement>(null);
  const dialogo = useRef<HTMLDivElement>(null);
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const [areaTam, setAreaTam] = useState<{ w: number; h: number } | null>(null);
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(false);
  /** ponto da foto (0–1) que deve ficar sob o dedo/cursor depois do zoom */
  const foco = useRef<{ fx: number; fy: number; ax: number; ay: number } | null>(null);
  const toque = useRef<{ x: number; y: number } | null>(null);
  const arraste = useRef<{ x: number; y: number; sl: number; st: number; moveu: boolean } | null>(null);

  const ir = useCallback(
    (passo: number) => {
      if (total < 2) return;
      setZoom(false);
      onIndice((indice + passo + total) % total);
    },
    [indice, onIndice, total],
  );

  // tamanho real da foto (já está no cache do navegador: é a mesma da miniatura)
  useEffect(() => {
    let vivo = true;
    const img = new Image();
    img.onload = () => vivo && setNatural({ src: foto.src, w: img.naturalWidth, h: img.naturalHeight });
    img.src = foto.src;
    return () => {
      vivo = false;
    };
  }, [foto.src]);

  // espaço disponível para a foto (o observador já avisa o tamanho inicial)
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setAreaTam({ w: el.clientWidth, h: el.clientHeight }));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // trava a rolagem da página, foco no botão de fechar e teclado (Esc, setas, Tab preso no visualizador)
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    botaoFechar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
      else if (e.key === 'ArrowLeft') ir(-1);
      else if (e.key === 'ArrowRight') ir(1);
      else if (e.key === 'Tab' && dialogo.current) {
        const focaveis = [...dialogo.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
        const primeiro = focaveis[0];
        const ultimo = focaveis.at(-1);
        if (!primeiro || !ultimo) return;
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro.focus();
        }
      }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.documentElement.style.overflow = overflow;
      anterior?.focus?.();
    };
  }, [ir, onFechar]);

  const carregada = natural?.src === foto.src ? natural : null;
  const escala = carregada && areaTam ? Math.min(areaTam.w / carregada.w, areaTam.h / carregada.h) : 0;
  const largura = carregada ? Math.round(carregada.w * escala * (zoom ? ZOOM : 1)) : 0;
  const altura = carregada ? Math.round(carregada.h * escala * (zoom ? ZOOM : 1)) : 0;

  // depois de ampliar, mantém sob o dedo/cursor o ponto tocado
  useLayoutEffect(() => {
    const el = area.current;
    const f = foco.current;
    if (!el || !f || !zoom) return;
    foco.current = null;
    const margemX = Math.max(0, (el.clientWidth - largura) / 2);
    const margemY = Math.max(0, (el.clientHeight - altura) / 2);
    el.scrollLeft = margemX + f.fx * largura - f.ax;
    el.scrollTop = margemY + f.fy * altura - f.ay;
  }, [zoom, largura, altura]);

  const alternarZoom = (e?: { clientX: number; clientY: number; currentTarget: Element }) => {
    if (!zoom) {
      const a = area.current?.getBoundingClientRect();
      if (e && a) {
        const r = e.currentTarget.getBoundingClientRect();
        foco.current = { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, ax: e.clientX - a.left, ay: e.clientY - a.top };
      } else {
        foco.current = { fx: 0.5, fy: 0.5, ax: (areaTam?.w ?? 0) / 2, ay: (areaTam?.h ?? 0) / 2 };
      }
    }
    setZoom((z) => !z);
  };

  const marcadores = foto.marcadores ?? [];
  const botaoClaro = 'focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none';

  return (
    <div
      ref={dialogo}
      role="dialog"
      aria-modal="true"
      aria-label={`Foto: ${foto.titulo}`}
      className="fixed inset-0 z-[70] flex flex-col bg-black pt-safe pb-safe text-white"
    >
      <header className="flex items-center gap-2 px-3 py-2 sm:px-5 sm:py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-semibold">{foto.titulo}</p>
            {foto.selo ? <span className="hidden shrink-0 sm:inline-flex">{foto.selo}</span> : null}
          </div>
          <p className="truncate text-xs text-white/60">
            {foto.subtitulo ? `${foto.subtitulo} · ` : ''}
            {indice + 1} de {total}
          </p>
        </div>
        <button
          type="button"
          onClick={() => alternarZoom()}
          aria-label={zoom ? 'Reduzir' : 'Ampliar'}
          aria-pressed={zoom}
          className={cn('flex size-10 items-center justify-center rounded-full text-white/85 hover:bg-white/10', botaoClaro)}
        >
          {zoom ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
        </button>
        <a
          href={foto.src}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-white/85 hover:bg-white/10', botaoClaro)}
        >
          <ExternalLink className="size-4" />
          <span className="max-sm:sr-only">Abrir original</span>
        </a>
        <button
          ref={botaoFechar}
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className={cn('flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20', botaoClaro)}
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={area}
          className={cn('flex size-full touch-pan-x touch-pan-y', zoom ? 'cursor-grab overflow-auto' : 'overflow-hidden')}
          onClick={(e) => {
            // toque fora da foto fecha
            if (e.target === e.currentTarget && !zoom) onFechar();
          }}
          onTouchStart={(e) => {
            const t = e.touches[0];
            toque.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const ini = toque.current;
            const t = e.changedTouches[0];
            toque.current = null;
            if (!ini || !t || zoom) return;
            // deslizar para o lado troca de foto
            const dx = t.clientX - ini.x;
            const dy = t.clientY - ini.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) ir(dx < 0 ? 1 : -1);
          }}
          onPointerDown={(e) => {
            // com zoom, o mouse arrasta a foto (no celular a rolagem já faz isso)
            if (!zoom || e.pointerType !== 'mouse' || !area.current) return;
            arraste.current = { x: e.clientX, y: e.clientY, sl: area.current.scrollLeft, st: area.current.scrollTop, moveu: false };
          }}
          onPointerMove={(e) => {
            const a = arraste.current;
            if (!a || !area.current) return;
            const dx = e.clientX - a.x;
            const dy = e.clientY - a.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) a.moveu = true;
            area.current.scrollLeft = a.sl - dx;
            area.current.scrollTop = a.st - dy;
          }}
          onPointerUp={() => {
            // o clique que encerra um arraste não altera o zoom
            setTimeout(() => (arraste.current = null), 0);
          }}
        >
          {carregada && largura > 0 ? (
            <div className="relative m-auto shrink-0 select-none" style={{ width: largura, height: altura }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={foto.src}
                alt={foto.titulo}
                draggable={false}
                onClick={(e) => {
                  if (arraste.current?.moveu) return;
                  alternarZoom(e);
                }}
                className={cn('block size-full', zoom ? 'cursor-zoom-out' : 'cursor-zoom-in')}
              />
              {marcadores.map((m, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-destructive text-xs font-bold text-white shadow"
                  style={{ left: `${m.x}%`, top: `${m.y}%` }}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          ) : (
            <Loader2 aria-label="Carregando foto" className="m-auto size-8 animate-spin text-white/70" />
          )}
        </div>

        {total > 1 ? (
          <>
            <button
              type="button"
              onClick={() => ir(-1)}
              aria-label="Foto anterior"
              className={cn(
                'absolute top-1/2 left-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 sm:left-4',
                botaoClaro,
              )}
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              onClick={() => ir(1)}
              aria-label="Próxima foto"
              className={cn(
                'absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 sm:right-4',
                botaoClaro,
              )}
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        ) : null}
      </div>

      {foto.observacao || marcadores.length ? (
        <footer className="max-h-[25dvh] overflow-y-auto px-4 py-3 text-sm text-white/85 sm:px-5">
          {marcadores.length ? (
            <p className="text-xs text-white/60">{marcadores.length === 1 ? '1 ponto marcado na foto' : `${marcadores.length} pontos marcados na foto`}</p>
          ) : null}
          {foto.observacao ? <p className="whitespace-pre-line">{foto.observacao}</p> : null}
        </footer>
      ) : null}
    </div>
  );
}
