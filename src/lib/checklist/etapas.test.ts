import { describe, expect, it } from 'vitest';
import {
  agruparItens,
  calcularStatusChecklist,
  contarSeveridades,
  fotoRecente,
  fotosEsperadas,
  totalFotosObrigatorias,
  type ItemChecklist,
} from './etapas';

const item = (codigo: string, grupo: string, ordem: number, condicional = false): ItemChecklist => ({
  codigo,
  nome: codigo,
  grupo,
  instrucao: null,
  pergunta: condicional ? `${codigo}?` : null,
  ordem,
  condicional,
});

const ITENS = [
  item('pneu_traseiro', 'Pneus', 230),
  item('frente', 'Exterior', 110),
  item('vazamento_avaria', 'Avarias', 610, true),
  item('pneu_dianteiro', 'Pneus', 210),
  item('traseira', 'Exterior', 120),
];

describe('agruparItens', () => {
  it('agrupa na ordem dos itens e mantém a ordem dentro do grupo', () => {
    expect(agruparItens(ITENS).map((g) => [g.grupo, g.itens.map((i) => i.codigo)])).toEqual([
      ['Exterior', ['frente', 'traseira']],
      ['Pneus', ['pneu_dianteiro', 'pneu_traseiro']],
      ['Avarias', ['vazamento_avaria']],
    ]);
  });
});

describe('fotosEsperadas (mesma regra da RPC)', () => {
  it('pergunta Sim/Não: a foto só entra com "Sim"', () => {
    expect(fotosEsperadas(ITENS, {})).toEqual(['frente', 'traseira', 'pneu_dianteiro', 'pneu_traseiro']);
    expect(fotosEsperadas(ITENS, { vazamento_avaria: false })).toHaveLength(4);
    expect(fotosEsperadas(ITENS, { vazamento_avaria: true })).toEqual([
      'frente', 'traseira', 'pneu_dianteiro', 'pneu_traseiro', 'vazamento_avaria',
    ]);
    expect(totalFotosObrigatorias(ITENS)).toBe(4);
  });
});

describe('fotoRecente (só câmera)', () => {
  const agora = Date.UTC(2026, 9, 5, 12);
  it('aceita foto tirada agora e recusa foto antiga de galeria', () => {
    expect(fotoRecente(agora - 5_000, agora)).toBe(true);
    expect(fotoRecente(agora - 60 * 60 * 1000, agora)).toBe(false);
  });
  it('aceita quando o navegador não informa a data', () => {
    expect(fotoRecente(0, agora)).toBe(true);
    expect(fotoRecente(Number.NaN, agora)).toBe(true);
  });
});

describe('status do checklist', () => {
  it('é a pior severidade e conta cada uma', () => {
    expect(calcularStatusChecklist([])).toBe('ok');
    expect(calcularStatusChecklist(['ok', 'atencao', 'ok'])).toBe('atencao');
    expect(calcularStatusChecklist(['atencao', 'critico'])).toBe('critico');
    expect(contarSeveridades(['ok', 'ok', 'critico'])).toEqual({ ok: 2, atencao: 0, critico: 1 });
  });
});
