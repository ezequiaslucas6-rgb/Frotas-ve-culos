'use client';

import { useId, useRef, useState } from 'react';
import { Camera, FileText, ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compressImage, formatBytes } from '@/lib/image/compress';
import { digitalizarCupom } from '@/lib/image/digitalizar';
import type { BucketName } from '@/lib/storage';
import { caminhoMiniatura } from '@/lib/storage-paths';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { uuid } from '@/lib/uuid';

interface FileUploadProps {
  /** nome do <input hidden> que leva o caminho do arquivo no Storage para a Server Action */
  name: string;
  label: string;
  bucket?: BucketName;
  /** pasta no bucket, sempre começando pela filial (ex.: <filialId>/veiculos/<id>); null = filial ainda não escolhida */
  pasta: string | null;
  /** prefixo do nome do arquivo (cada envio ganha um sufixo único) */
  arquivo: string;
  /** maior lado da imagem após a compressão (documentos pedem mais resolução) */
  maxDimension?: number;
  /** também grava uma miniatura (<arquivo>.mini.jpg) com este maior lado, para listas */
  miniatura?: number;
  /** mensagem quando a pasta ainda não está definida */
  semPastaMsg?: string;
  accept: string;
  /** caminho já salvo (edição) e a URL assinada para exibi-lo */
  initialPath?: string | null;
  initialUrl?: string | null;
  hint?: string;
  capture?: boolean;
  /** modo digitalização (cupom): recorta o papel, tira sombra e reforça o contraste */
  digitalizar?: boolean;
  /** avisa quando um arquivo novo foi enviado (ou removido: null) */
  onEnviado?: (path: string | null) => void;
}

type Phase = 'idle' | 'compressing' | 'uploading' | 'error';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Upload direto do browser para o Supabase Storage (buckets privados), com
 * compressão de imagem antes do envio. PDFs sobem como estão. O formulário recebe
 * apenas o caminho (input hidden) — o arquivo nunca passa pela Server Action.
 *
 * Todo envio grava um NOME NOVO (nunca sobrescreve): o arquivo é imutável, então o
 * navegador pode guardá-lo em cache por muito tempo e a URL assinada é reaproveitada.
 */
export function FileUpload({
  name,
  label,
  bucket = 'veiculos',
  pasta,
  arquivo,
  maxDimension = 1600,
  miniatura,
  semPastaMsg = 'Selecione a filial antes de enviar arquivos.',
  accept,
  initialPath = null,
  initialUrl = null,
  hint,
  capture,
  digitalizar = false,
  onEnviado,
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
    if (!pasta) {
      setError(semPastaMsg);
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
      let mini: Blob | null = null;

      if (!pdf && digitalizar) {
        setPhase('compressing');
        let pronto: { blob: Blob; originalSize: number };
        let rotulo = 'Digitalizado';
        try {
          pronto = await digitalizarCupom(file, { maxDimension });
        } catch {
          // aparelho sem canvas suficiente: segue com a foto comum
          pronto = await compressImage(file, { maxDimension, quality: 0.85 });
          rotulo = 'Foto';
        }
        body = pronto.blob;
        contentType = 'image/jpeg';
        ext = 'jpg';
        info = `${rotulo} · ${formatBytes(pronto.originalSize)} → ${formatBytes(pronto.blob.size)}`;
      } else if (!pdf) {
        setPhase('compressing');
        const compressed = await compressImage(file, { maxDimension, quality: 0.82 });
        body = compressed.blob;
        contentType = compressed.blob.type || 'image/jpeg';
        ext = 'jpg';
        info = `${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.blob.size)}`;
        // a miniatura sai da imagem já reduzida (decodificar a foto original de novo pesa no celular)
        if (miniatura) mini = (await compressImage(body, { maxDimension: miniatura, quality: 0.75 })).blob;
      }

      setPhase('uploading');
      const destino = `${pasta}/${arquivo}-${uuid()}.${ext}`;
      const storage = createClient().storage.from(bucket);
      const opcoes = { upsert: false, cacheControl: '31536000' }; // 1 ano: o nome nunca é reutilizado
      const [{ error: uploadError }] = await Promise.all([
        storage.upload(destino, body, { ...opcoes, contentType }),
        // miniatura é opcional: se falhar, as listas usam a imagem completa
        mini ? storage.upload(caminhoMiniatura(destino), mini, { ...opcoes, contentType: 'image/jpeg' }).catch(() => null) : null,
      ]);
      if (uploadError) throw new Error('Falha no envio. Verifique a conexão e tente novamente.');

      setPath(destino);
      onEnviado?.(destino);
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

      <div className={cn('flex items-center gap-3 rounded-2xl border border-dashed border-border bg-raised/40 p-3', error && 'border-destructive')}>
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
            <p className="text-muted-foreground">
              {phase === 'compressing' ? (digitalizar ? 'Digitalizando o cupom…' : 'Comprimindo imagem…') : 'Enviando…'}
            </p>
          ) : path ? (
            <>
              <p className="font-medium">{isPdf ? 'PDF anexado' : 'Imagem anexada'}</p>
              {fileInfo ? <p className="text-xs text-muted-foreground">{fileInfo}</p> : null}
            </>
          ) : (
            <p className="text-muted-foreground">{hint ?? 'Nenhum arquivo enviado.'}</p>
          )}
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive-text">
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
                onEnviado?.(null);
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
