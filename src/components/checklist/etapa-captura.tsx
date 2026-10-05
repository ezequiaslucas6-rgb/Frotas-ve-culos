'use client';

import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Camera, CircleCheck, Loader2, MapPin, OctagonAlert, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { SEVERIDADE_LABEL, type MarcadorAvaria, type Severidade } from '@/lib/checklist/etapas';
import { cn } from '@/lib/utils';
import type { EtapaState } from './types';

interface EtapaCapturaProps {
  /** nome do item (texto alternativo da foto) */
  titulo: string;
  estado: EtapaState;
  /** item de avaria (pergunta respondida com "Sim"): só Atenção ou Avaria */
  somenteProblema?: boolean;
  onFile: (file: File) => void;
  onRetry: () => void;
  onChange: (patch: Partial<Pick<EtapaState, 'severidade' | 'observacao' | 'marcadores'>>) => void;
  /** conteúdo extra da etapa (ex.: campo de KM no painel) */
  children?: ReactNode;
}

const SEVERIDADES: Array<{ value: Severidade; icon: typeof CircleCheck; classes: string }> = [
  { value: 'ok', icon: CircleCheck, classes: 'data-[active=true]:border-success data-[active=true]:bg-success/15 data-[active=true]:text-success-text' },
  { value: 'atencao', icon: AlertTriangle, classes: 'data-[active=true]:border-warning data-[active=true]:bg-warning/25 data-[active=true]:text-warning-text' },
  { value: 'critico', icon: OctagonAlert, classes: 'data-[active=true]:border-destructive data-[active=true]:bg-destructive/15 data-[active=true]:text-destructive-text' },
];

/**
 * Captura de uma foto do checklist. Só câmera: não há opção de galeria (e o assistente
 * ainda recusa arquivos antigos). No APK, o campo com `capture` abre a câmera direto.
 */
export function EtapaCaptura({ titulo, estado, somenteProblema = false, onFile, onRetry, onChange, children }: EtapaCapturaProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const [marcando, setMarcando] = useState(false);
  const opcoes = somenteProblema ? SEVERIDADES.filter((s) => s.value !== 'ok') : SEVERIDADES;

  const ocupado = estado.fase === 'processando' || estado.fase === 'enviando';
  const temFoto = Boolean(estado.previewUrl);

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite capturar de novo
    if (file) onFile(file);
  }

  function addMarcador(event: React.MouseEvent<HTMLDivElement>) {
    if (!marcando) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const marcador: MarcadorAvaria = {
      x: Math.min(100, Math.max(0, Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10)),
      y: Math.min(100, Math.max(0, Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10)),
    };
    onChange({
      marcadores: [...estado.marcadores, marcador].slice(0, 20),
      // marcar uma avaria na foto sinaliza automaticamente a etapa (pode ser ajustado abaixo)
      ...(estado.severidade === 'ok' ? { severidade: 'atencao' as const } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* input oculto: só a câmera traseira (capture), sem galeria */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={pick} data-testid="camera" />

      {!temFoto ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-card px-4 py-10 text-center">
          {ocupado ? (
            <>
              <Loader2 className="size-12 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground" role="status">
                {estado.fase === 'processando' ? 'Comprimindo foto…' : 'Enviando foto…'}
              </p>
            </>
          ) : (
            <>
              <Camera className="size-12 text-muted-foreground" />
              <Button type="button" size="xl" className="w-full max-w-xs" onClick={() => cameraRef.current?.click()}>
                <Camera className="size-5" /> Tirar foto
              </Button>
              <p className="text-xs text-muted-foreground">Abre a câmera. Fotos da galeria não são aceitas.</p>
            </>
          )}
          {estado.erro ? (
            <div role="alert" className="flex flex-col items-center gap-2 text-sm font-medium text-destructive-text">
              {estado.erro}
              {estado.fase === 'erro' ? (
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  <RotateCcw /> Tentar novamente
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* o wrapper tem exatamente o tamanho da imagem => marcadores em % ficam alinhados */}
          <div
            className={cn('relative mx-auto w-fit overflow-hidden rounded-xl border bg-muted', marcando && 'cursor-crosshair ring-2 ring-destructive')}
            onClick={addMarcador}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={estado.previewUrl!} alt={`Foto: ${titulo}`} className="block max-h-[52dvh] w-auto max-w-full select-none" draggable={false} />
            {estado.marcadores.map((m, i) => (
              <span
                key={`${m.x}-${m.y}-${i}`}
                aria-hidden
                className="pointer-events-none absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-destructive text-xs font-bold text-white shadow-md"
                style={{ left: `${m.x}%`, top: `${m.y}%` }}
              >
                {i + 1}
              </span>
            ))}
            <div className="absolute top-2 left-2" role="status" aria-live="polite">
              {estado.fase === 'enviada' ? (
                <span className="flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-xs font-medium text-success-foreground shadow">
                  <CircleCheck className="size-3.5" /> Enviada{estado.tamanho ? ` · ${estado.tamanho}` : ''}
                </span>
              ) : ocupado ? (
                <span className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white">
                  <Loader2 className="size-3.5 animate-spin" /> {estado.fase === 'processando' ? 'Comprimindo…' : 'Enviando…'}
                </span>
              ) : estado.fase === 'erro' ? (
                <span className="flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground">
                  <AlertTriangle className="size-3.5" /> Falha no envio
                </span>
              ) : null}
            </div>
          </div>

          {estado.erro ? (
            <p role="alert" className="text-center text-sm font-medium text-destructive-text">
              {estado.erro}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {estado.fase === 'erro' ? (
              <Button type="button" variant="outline" size="lg" onClick={onRetry}>
                <RotateCcw /> Reenviar
              </Button>
            ) : (
              <Button type="button" variant="outline" size="lg" disabled={ocupado} onClick={() => cameraRef.current?.click()}>
                <RefreshCw /> Refazer foto
              </Button>
            )}
            <Button
              type="button"
              variant={marcando ? 'destructive' : 'outline'}
              size="lg"
              disabled={ocupado}
              aria-pressed={marcando}
              onClick={() => setMarcando((v) => !v)}
            >
              <MapPin /> {marcando ? 'Toque na foto…' : 'Marcar avaria'}
            </Button>
          </div>

          {estado.marcadores.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Marcadores de avaria">
              {estado.marcadores.map((_, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onChange({ marcadores: estado.marcadores.filter((__, j) => j !== i) })}
                    className="flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 py-1 pr-2 pl-1 text-xs font-medium text-destructive-text"
                    aria-label={`Remover marcador ${i + 1}`}
                  >
                    <span className="flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] text-white">{i + 1}</span>
                    Remover <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {children}

      <fieldset className="flex flex-col gap-2" disabled={!temFoto}>
        <legend className="mb-1 text-sm font-medium">Condição deste item</legend>
        <div role="radiogroup" aria-label="Condição do item" className={cn('grid gap-2', somenteProblema ? 'grid-cols-2' : 'grid-cols-3')}>
          {opcoes.map(({ value, icon: Icon, classes }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={estado.severidade === value}
              data-active={estado.severidade === value}
              onClick={() => onChange({ severidade: value })}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 bg-card px-1 text-sm font-semibold transition-colors disabled:opacity-50',
                classes,
              )}
            >
              <Icon className="size-5" />
              {SEVERIDADE_LABEL[value]}
            </button>
          ))}
        </div>
        {estado.severidade !== 'ok' ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="obs-etapa" className="text-sm font-medium">
              Descreva a inconformidade <span className="text-destructive-text">*</span>
            </label>
            <Textarea
              id="obs-etapa"
              rows={3}
              value={estado.observacao}
              maxLength={1000}
              onChange={(e) => onChange({ observacao: e.target.value })}
              placeholder={somenteProblema ? 'Ex.: vazamento de óleo embaixo do motor; amassado na porta…' : 'Ex.: pneu careca; trinca no retrovisor…'}
              aria-invalid={!estado.observacao.trim()}
            />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
