import { createLucideIcon } from 'lucide-react';

/**
 * Bomba de combustível (desenho enviado pela empresa, redesenhado em vetor sem a marca
 * d'água): corpo com visor e teclas, base, mangueira e bico. Mesmo traço dos ícones Lucide,
 * então aceita as mesmas props (className, size, strokeWidth) e herda a cor do texto.
 */
export const BombaCombustivel = createLucideIcon('BombaCombustivel', [
  ['path', { d: 'M4 20V4a2.5 2.5 0 0 1 2.5-2.5h6.5A2.5 2.5 0 0 1 15.5 4v16', key: 'corpo' }],
  ['path', { d: 'M2.5 20h14.5a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V21a1 1 0 0 1 1-1z', key: 'base' }],
  ['rect', { x: '6.75', y: '4.25', width: '6', height: '4.25', rx: '1', key: 'visor' }],
  ['path', { d: 'M7.25 12h1.5M10.75 12h1.5M7.25 15h1.5M10.75 15h1.5', strokeWidth: 1.5, key: 'teclas' }],
  ['path', { d: 'M15.5 7.5h.75A1.75 1.75 0 0 1 18 9.25V17a1.75 1.75 0 0 0 3.5 0V10.5', key: 'mangueira' }],
  ['path', { d: 'M20 10.5h3V8.25l-1.5-1.5-1.5 1.5z', key: 'bico' }],
  ['path', { d: 'm21.5 6.75-2.5-3.25', key: 'ponta' }],
]);
