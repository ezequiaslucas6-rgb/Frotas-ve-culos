/**
 * Compressão de imagem no browser (canvas) antes do upload.
 * Fotos de celular têm 3–12 MB; redimensionar para ~1600px e recodificar em JPEG
 * (qualidade ~0.8) cai para algumas centenas de KB sem perda perceptível — economiza
 * dados móveis, tempo de envio e armazenamento.
 */
export interface CompressOptions {
  /** maior lado da imagem final, em px */
  maxDimension?: number;
  /** 0–1 */
  quality?: number;
}

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  originalSize: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<DecodedImage> {
  // createImageBitmap respeita a orientação EXIF (foto "em pé" do celular)
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      /* cai para <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function compressImage(
  file: File | Blob,
  { maxDimension = 1600, quality = 0.8 }: CompressOptions = {},
): Promise<CompressedImage> {
  const image = await decode(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível neste dispositivo.');
    ctx.fillStyle = '#ffffff'; // PNG com transparência -> fundo branco no JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Não foi possível comprimir a imagem.');

    // JPEG já pequeno e sem redimensionar: mantém o original (evita recompressão com perda)
    if (scale === 1 && file.type === 'image/jpeg' && file.size <= blob.size) {
      return { blob: file, width, height, originalSize: file.size };
    }
    return { blob, width, height, originalSize: file.size };
  } finally {
    image.release();
  }
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
