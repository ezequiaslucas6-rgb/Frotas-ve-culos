'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Flashlight, FlashlightOff, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Maior lado da foto tirada aqui (o checklist ainda reduz para 1600 px). */
const MAIOR_LADO = 1920;

/** A câmera dentro da página existe neste navegador? */
export const cameraNaTelaDisponivel = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

type Estado = { fase: 'abrindo' } | { fase: 'pronta' } | { fase: 'tirando' } | { fase: 'erro'; mensagem: string };

/**
 * Câmera dentro da própria página (getUserMedia), sem sair do app.
 *
 * Com o app de câmera do celular (input com `capture`), o sistema fica em segundo plano
 * enquanto a pessoa fotografa. Em celulares com pouca memória (ex.: Redmi 14C com 4 GB e
 * HyperOS) o Android encerra o app ou o Chrome nesse meio tempo e, na volta, a foto se perde
 * ("volta e não anexa"). Aqui a foto sai do vídeo da câmera, já num tamanho moderado, e a
 * página nunca sai da tela. Se a câmera não abrir (permissão negada, APK antigo), oferece
 * o app de câmera do celular.
 */
export function CameraNaTela({
  titulo,
  onFoto,
  onFechar,
  onUsarAppDeCamera,
}: {
  titulo: string;
  onFoto: (file: File) => void;
  onFechar: () => void;
  /** abre o app de câmera do celular (o caminho antigo); chamado dentro do toque */
  onUsarAppDeCamera: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: 'abrindo' });
  const [lanterna, setLanterna] = useState<boolean | null>(null); // null = o aparelho não oferece

  useEffect(() => {
    let cancelado = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: MAIOR_LADO }, height: { ideal: 1440 } },
      })
      .then(async (stream) => {
        if (cancelado) return stream.getTracks().forEach((t) => t.stop());
        fluxo.current = stream;
        const v = video.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
        const faixa = stream.getVideoTracks()[0];
        const recursos = (faixa?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setLanterna(recursos.torch ? false : null);
        setEstado({ fase: 'pronta' });
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        const nome = e instanceof DOMException ? e.name : '';
        setEstado({
          fase: 'erro',
          mensagem:
            nome === 'NotAllowedError' || nome === 'SecurityError'
              ? 'A câmera não foi liberada para o app. Permita o uso da câmera ou use o app de câmera do celular.'
              : 'Não foi possível abrir a câmera aqui. Use o app de câmera do celular.',
        });
      });
    // celular volta da tela de bloqueio etc.: o vídeo continua; ao fechar, a câmera é desligada
    return () => {
      cancelado = true;
      fluxo.current?.getTracks().forEach((t) => t.stop());
      fluxo.current = null;
    };
  }, []);

  // trava a rolagem da página por baixo
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  async function alternarLanterna() {
    const faixa = fluxo.current?.getVideoTracks()[0];
    if (!faixa || lanterna == null) return;
    try {
      await faixa.applyConstraints({ advanced: [{ torch: !lanterna } as MediaTrackConstraintSet] });
      setLanterna(!lanterna);
    } catch {
      setLanterna(null);
    }
  }

  async function tirar() {
    const v = video.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    setEstado({ fase: 'tirando' });
    const escala = Math.min(1, MAIOR_LADO / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * escala);
    canvas.height = Math.round(v.videoHeight * escala);
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setEstado({ fase: 'erro', mensagem: 'Não foi possível tirar a foto. Use o app de câmera do celular.' });
      return;
    }
    onFoto(new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Foto: ${titulo}`} className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="flex items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <p className="min-w-0 flex-1 truncate font-medium">{titulo}</p>
        {lanterna != null ? (
          <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/15" aria-pressed={lanterna} aria-label="Lanterna" onClick={alternarLanterna}>
            {lanterna ? <Flashlight /> : <FlashlightOff />}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/15" aria-label="Fechar" onClick={onFechar}>
          <X />
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video ref={video} playsInline muted autoPlay className="max-h-full max-w-full object-contain" />
        {estado.fase === 'abrindo' ? <Loader2 className="absolute size-10 animate-spin" aria-label="Abrindo a câmera" /> : null}
        {estado.fase === 'erro' ? (
          <div role="alert" className="absolute inset-x-4 flex flex-col items-center gap-4 text-center">
            <p className="text-sm">{estado.mensagem}</p>
            <Button type="button" size="lg" onClick={onUsarAppDeCamera}>
              <Camera /> Usar o app de câmera
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 px-6 pt-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <button type="button" className="w-24 text-left text-xs text-white/80 underline-offset-2 hover:underline" onClick={onUsarAppDeCamera}>
          Usar o app de câmera
        </button>
        <button
          type="button"
          aria-label="Tirar foto"
          disabled={estado.fase !== 'pronta'}
          onClick={tirar}
          className="flex size-18 items-center justify-center rounded-full border-4 border-white/80 bg-white/20 transition active:scale-95 disabled:opacity-40"
        >
          {estado.fase === 'tirando' ? <Loader2 className="size-7 animate-spin" /> : <span className="size-14 rounded-full bg-white" />}
        </button>
        <span className="w-24" />
      </div>
    </div>,
    document.body,
  );
}
