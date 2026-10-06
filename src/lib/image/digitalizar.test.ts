import { describe, expect, it } from 'vitest';
import { detectarPapel, limiarOtsu, realcarDocumento } from './digitalizar';

/** Imagem sintética: fundo escuro, papel claro com "texto" (linhas escuras). */
function foto(w: number, h: number, papel: { x: number; y: number; w: number; h: number }, fundo = 55, branco = 215) {
  const lum = new Uint8Array(w * h).fill(fundo);
  for (let y = papel.y; y < papel.y + papel.h; y++) {
    for (let x = papel.x; x < papel.x + papel.w; x++) {
      const texto = (y - papel.y) % 12 < 3 && (x - papel.x) % 7 < 4 && x > papel.x + 6 && x < papel.x + papel.w - 6;
      lum[y * w + x] = texto ? 70 : branco;
    }
  }
  return lum;
}

describe('recorte do papel', () => {
  it('acha o cupom no meio da foto (com folga, sem cortar)', () => {
    const papel = { x: 60, y: 30, w: 110, h: 230 };
    const r = detectarPapel(foto(300, 300, papel), 300, 300)!;
    expect(r).not.toBeNull();
    expect(r.x).toBeLessThanOrEqual(papel.x);
    expect(r.y).toBeLessThanOrEqual(papel.y);
    expect(r.x + r.w).toBeGreaterThanOrEqual(papel.x + papel.w);
    expect(r.y + r.h).toBeGreaterThanOrEqual(papel.y + papel.h);
    expect(r.w).toBeLessThan(140);
  });

  it('não recorta quando o papel já ocupa a foto ou quando não há contraste com o fundo', () => {
    expect(detectarPapel(foto(200, 200, { x: 2, y: 2, w: 196, h: 196 }), 200, 200)).toBeNull();
    expect(detectarPapel(foto(200, 200, { x: 50, y: 20, w: 100, h: 160 }, 190, 215), 200, 200)).toBeNull();
  });

  it('Otsu separa papel e fundo', () => {
    const { limiar, separacao } = limiarOtsu(foto(100, 100, { x: 20, y: 20, w: 60, h: 60 }));
    expect(limiar).toBeGreaterThan(55);
    expect(limiar).toBeLessThan(215);
    expect(separacao).toBeGreaterThan(100);
  });
});

describe('realce de documento', () => {
  it('sombra de um lado some: o papel fica branco e o texto escuro em toda a folha', () => {
    const w = 200;
    const h = 200;
    const lum = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const papel = 120 + (x / w) * 110; // de 120 (sombra) a 230 (luz)
        const texto = y % 16 < 4 && x % 9 < 5;
        lum[y * w + x] = Math.round(texto ? papel * 0.45 : papel);
      }
    }
    const out = realcarDocumento(lum, w, h);
    const ponto = (x: number, y: number) => out[y * w + x]!;
    // papel (y % 16 >= 4) dos dois lados
    expect(ponto(10, 10)).toBeGreaterThan(235);
    expect(ponto(190, 10)).toBeGreaterThan(235);
    // texto (y % 16 < 4, x % 9 < 5) dos dois lados
    expect(ponto(9, 1)).toBeLessThan(90);
    expect(ponto(189, 1)).toBeLessThan(90);
  });
});
