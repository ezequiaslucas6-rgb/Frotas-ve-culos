/**
 * "Modo digitalização" do cupom, no próprio celular, antes do envio:
 *  1. recorta o papel (tira o banco do carro, a mão, o balcão em volta);
 *  2. tira sombra e luz irregular (divide cada ponto pelo "branco do papel" ao redor);
 *  3. reforça o contraste e escurece a impressão térmica apagada;
 *  4. salva em tons de cinza, com resolução maior que a das outras fotos.
 * Assim a leitura (IA ou pessoa) enxerga melhor números e rótulos.
 *
 * As funções de cálculo são puras (testadas); só `digitalizarCupom` usa o navegador.
 */
import { decodificarImagem } from './compress';

export interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tons de cinza (luminância) de uma imagem RGBA. */
export function luminancia(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000;
  }
  return lum;
}

/** Limiar de Otsu (separa "claro" de "escuro") e a distância entre as médias das duas classes. */
export function limiarOtsu(lum: Uint8Array): { limiar: number; separacao: number } {
  const hist = new Float64Array(256);
  for (const v of lum) hist[v]! += 1;
  const total = lum.length;
  let soma = 0;
  for (let i = 0; i < 256; i++) soma += i * hist[i]!;
  let somaB = 0;
  let pesoB = 0;
  let melhor = { limiar: 127, variancia: -1, separacao: 0 };
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t]!;
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    somaB += t * hist[t]!;
    const mB = somaB / pesoB;
    const mF = (soma - somaB) / pesoF;
    const variancia = pesoB * pesoF * (mB - mF) ** 2;
    if (variancia > melhor.variancia) melhor = { limiar: t, variancia, separacao: mF - mB };
  }
  return { limiar: melhor.limiar, separacao: melhor.separacao };
}

/** Maior sequência contínua de posições com fração >= mínimo. */
function maiorTrecho(fracoes: Float64Array, minimo: number): [number, number] | null {
  let melhor: [number, number] | null = null;
  let inicio = -1;
  for (let i = 0; i <= fracoes.length; i++) {
    const dentro = i < fracoes.length && fracoes[i]! >= minimo;
    if (dentro && inicio < 0) inicio = i;
    if (!dentro && inicio >= 0) {
      if (!melhor || i - inicio > melhor[1] - melhor[0]) melhor = [inicio, i];
      inicio = -1;
    }
  }
  return melhor;
}

/**
 * Onde está o papel (claro) na foto. null quando não dá para separar o papel do fundo com
 * segurança ou quando ele já ocupa quase a foto toda — nesses casos não se recorta nada.
 */
export function detectarPapel(lum: Uint8Array, w: number, h: number): Retangulo | null {
  const { limiar, separacao } = limiarOtsu(lum);
  if (separacao < 50) return null; // papel e fundo parecidos demais

  const colunas = new Float64Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lum[y * w + x]! > limiar) colunas[x]! += 1;
  for (let x = 0; x < w; x++) colunas[x]! /= h;
  const trechoX = maiorTrecho(colunas, 0.3);
  if (!trechoX) return null;

  const linhas = new Float64Array(h);
  const larg = trechoX[1] - trechoX[0];
  for (let y = 0; y < h; y++) {
    let claros = 0;
    for (let x = trechoX[0]; x < trechoX[1]; x++) if (lum[y * w + x]! > limiar) claros++;
    linhas[y] = claros / larg;
  }
  const trechoY = maiorTrecho(linhas, 0.45);
  if (!trechoY) return null;

  // folga de 2% para não cortar a borda do papel
  const folgaX = Math.round(w * 0.02);
  const folgaY = Math.round(h * 0.02);
  const x = Math.max(0, trechoX[0] - folgaX);
  const y = Math.max(0, trechoY[0] - folgaY);
  const r = { x, y, w: Math.min(w, trechoX[1] + folgaX) - x, h: Math.min(h, trechoY[1] + folgaY) - y };
  const area = (r.w * r.h) / (w * h);
  if (area > 0.9 || area < 0.08 || r.w < w * 0.15 || r.h < h * 0.15) return null;
  return r;
}

/**
 * Realce de documento: divide pelo "branco do papel" local (o maior tom em cada bloco,
 * suavizado), estica o contraste e escurece os tons médios (impressão térmica apagada).
 */
export function realcarDocumento(lum: Uint8Array, w: number, h: number): Uint8Array {
  const bloco = Math.max(16, Math.round(Math.max(w, h) / 40));
  const gw = Math.ceil(w / bloco);
  const gh = Math.ceil(h / bloco);

  // branco do papel em cada bloco (o texto raramente enche um bloco inteiro)
  const grade = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / bloco) * gw;
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x]!;
      const g = gy + Math.floor(x / bloco);
      if (v > grade[g]!) grade[g] = v;
    }
  }
  // suaviza a grade (3×3) para não marcar os blocos
  const suave = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = gy + dy;
          const xx = gx + dx;
          if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue;
          s += grade[yy * gw + xx]!;
          n++;
        }
      }
      suave[gy * gw + gx] = s / n;
    }
  }

  // divide pelo fundo (interpolado entre os centros dos blocos)
  const norm = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / bloco - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / bloco - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const fundo =
        (suave[y0 * gw + x0]! * (1 - tx) + suave[y0 * gw + x1]! * tx) * (1 - ty) +
        (suave[y1 * gw + x0]! * (1 - tx) + suave[y1 * gw + x1]! * tx) * ty;
      const v = Math.min(255, Math.round((lum[y * w + x]! * 255) / Math.max(fundo, 48)));
      norm[y * w + x] = v;
      hist[v]! += 1;
    }
  }

  // contraste: o 1% mais escuro vira preto; o tom do papel (a maior parte dos pontos) vira branco
  const percentil = (p: number) => {
    const alvo = p * w * h;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i]!;
      if (acc >= alvo) return i;
    }
    return 255;
  };
  const lo = percentil(0.01);
  const hi = Math.max(lo + 32, percentil(0.4)); // a maior parte do cupom é papel (o texto fica bem abaixo)
  const tabela = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    tabela[v] = Math.round(255 * t ** 1.4); // escurece os cinzas (dígitos apagados)
  }
  for (let i = 0; i < norm.length; i++) norm[i] = tabela[norm[i]!]!;
  return norm;
}

export interface CupomDigitalizado {
  blob: Blob;
  width: number;
  height: number;
  originalSize: number;
  recortado: boolean;
}

/** Digitaliza a foto do cupom no navegador (canvas). */
export async function digitalizarCupom(
  arquivo: Blob,
  { maxDimension = 2200, quality = 0.85 }: { maxDimension?: number; quality?: number } = {},
): Promise<CupomDigitalizado> {
  const imagem = await decodificarImagem(arquivo);
  try {
    // 1. procura o papel numa cópia pequena (rápido)
    const escalaP = Math.min(1, 480 / Math.max(imagem.width, imagem.height));
    const pw = Math.max(1, Math.round(imagem.width * escalaP));
    const ph = Math.max(1, Math.round(imagem.height * escalaP));
    const pequeno = desenhar(imagem.source, 0, 0, imagem.width, imagem.height, pw, ph);
    const papel = detectarPapel(luminancia(pequeno.getImageData(0, 0, pw, ph).data, pw, ph), pw, ph);
    const recorte = papel
      ? { x: papel.x / escalaP, y: papel.y / escalaP, w: papel.w / escalaP, h: papel.h / escalaP }
      : { x: 0, y: 0, w: imagem.width, h: imagem.height };

    // 2. recorta já na resolução final e realça
    const escala = Math.min(1, maxDimension / Math.max(recorte.w, recorte.h));
    const w = Math.max(1, Math.round(recorte.w * escala));
    const h = Math.max(1, Math.round(recorte.h * escala));
    const ctx = desenhar(imagem.source, recorte.x, recorte.y, recorte.w, recorte.h, w, h);
    const dados = ctx.getImageData(0, 0, w, h);
    const cinza = realcarDocumento(luminancia(dados.data, w, h), w, h);
    for (let i = 0, p = 0; i < cinza.length; i++, p += 4) {
      dados.data[p] = dados.data[p + 1] = dados.data[p + 2] = cinza[i]!;
      dados.data[p + 3] = 255;
    }
    ctx.putImageData(dados, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => ctx.canvas.toBlob(ok, 'image/jpeg', quality));
    if (!blob) throw new Error('Não foi possível digitalizar a foto.');
    return { blob, width: w, height: h, originalSize: arquivo.size, recortado: Boolean(papel) };
  } finally {
    imagem.release();
  }
}

function desenhar(fonte: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas indisponível neste dispositivo.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, w, h);
  return ctx;
}
