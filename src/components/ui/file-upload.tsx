'use client';

import { useId, useRef, useState } from 'react';
import { Camera, FileText, ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compressImage, formatBytes } from '@/lib/image/compress';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  /** nome do <input hidden> que leva o caminho do arquivo no Storage para a Server Action */
  name: string;
  label: string;
  /** destino no bucket "veiculos": <filialId>/veiculos/<pastaId>/<arquivo> */
  filialId: string | null;
  pastaId: string;
  arquivo: 'foto-geral' | 'documento';
  accept: string;
  /** caminho já salvo (edição) e a URL assinada para exibi-lo */
  initialPath?: string | null;
  initialUrl?: string | null;
  hint?: string;
  capture?: boolean;
}

type Phase = 'idle' | 'compressing' | 'uploading' | 'error';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Upload direto do browser para o Supabase Storage (bucket privado "veiculos"), com
 * compressão de imagem antes do envio. PDFs sobem como estão. O formulário recebe
 * apenas o caminho (input hidden) — o arquivo nunca passa pela Server Action
 * (evita o limite de payload da Vercel).
 */
export function FileUpload({
  name,
  label,
  filialId,
  pastaId,
  arquivo,
  accept,
  initialPath = null,
  initialUrl = null,
  hint,
  capture,
}: FileUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string | null>(initialPath);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [isPdf, setIsPdf] = useState(initialPath?.toLowerCase().endsWith('.pdf') ?? false);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!filialId) {
      setError('Selecione a filial antes de enviar arquivos.');
      setPhase('error');
      return;
    }
    setError(null);
    try {
      const pdf = file.type === 'application/pdf';
      if (!pdf && !file.type.startsWith('image/')) throw new Error('Formato não suportado. Envie imagem ou PDF.');
      if (pdf && !accept.includes('pdf')) throw new Error('Este campo aceita apenas imagem.');
      if (pdf && file.size > MAX_PDF_BYTES) throw new Error('PDF acima de 10 MB.');

      let body: Blob = file;
      let contentType = file.type;
      let ext = pdf ? 'pdf' : 'jpg';
      let info = formatBytes(file.size);

      if (!pdf) {
        setPhase('compressing');
        const compressed = await compressImage(file, { maxDimension: arquivo === 'documento' ? 2200 : 1600, quality: 0.82 });
        body = compressed.blob;
        contentType = compressed.blob.type || 'image/jpeg';
        ext = 'jpg';
        info = `${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.blob.size)}`;
      }

      setPhase('uploading');
      const destino = `${filialId}/veiculos/${pastaId}/${arquivo}.${ext}`;
      const { error: uploadError } = await createClient()
        .storage.from('veiculos')
        .upload(destino, body, { upsert: true, contentType, cacheControl: '3600' });
      if (uploadError) throw new Error('Falha no envio. Verifique a conexão e tente novamente.');

      setPath(destino);
      setIsPdf(pdf);
      setFileInfo(info);
      setPreviewUrl((old) => {
        if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
        return pdf ? null : URL.createObjectURL(body);
      });
      setPhase('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.');
      setPhase('error');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const busy = phase === 'compressing' || phase === 'uploading';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm leading-none font-medium">
        {label}
      </label>
      <input type="hidden" name={name} value={path ?? ''} />
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        capture={capture ? 'environment' : undefined}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <div className={cn('flex items-center gap-3 rounded-lg border border-dashed bg-card p-3', error && 'border-destructive')}>
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {busy ? (
            <Loader2 className="size-6 animate-spin" />
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={label} className="size-full object-cover" />
          ) : isPdf && path ? (
            <FileText className="size-7" />
          ) : (
            <ImagePlus className="size-6" />
          )}
        </div>

        <div className="min-w-0 flex-1 text-sm">
          {busy ? (
            <p className="text-muted-foreground">{phase === 'compressing' ? 'Comprimindo imagem…' : 'Enviando…'}</p>
          ) : path ? (
            <>
              <p className="font-medium">{isPdf ? 'PDF anexado' : 'Imagem anexada'}</p>
              {fileInfo ? <p className="text-xs text-muted-foreground">{fileInfo}</p> : null}
            </>
          ) : (
            <p className="text-muted-foreground">{hint ?? 'Nenhum arquivo enviado.'}</p>
          )}
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {path ? <RefreshCw /> : capture ? <Camera /> : <ImagePlus />}
            {path ? 'Trocar' : 'Enviar'}
          </Button>
          {path && !busy ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover ${label}`}
              onClick={() => {
                setPath(null);
                setPreviewUrl(null);
                setIsPdf(false);
                setFileInfo(null);
              }}
            >
              <X />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
