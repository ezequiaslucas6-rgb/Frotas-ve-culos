import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_ETAPAS,
  TOTAL_ETAPAS,
  calcularStatusChecklist,
  caminhoFotoChecklist,
  contarSeveridades,
} from './etapas';

describe('etapas do checklist', () => {
  it('são 14 etapas com categorias únicas', () => {
    expect(TOTAL_ETAPAS).toBe(14);
    expect(new Set(CHECKLIST_ETAPAS.map((e) => e.categoria)).size).toBe(14);
  });
  it('a pior severidade define o status geral', () => {
    expect(calcularStatusChecklist([])).toBe('ok');
    expect(calcularStatusChecklist(['ok', 'ok'])).toBe('ok');
    expect(calcularStatusChecklist(['ok', 'atencao'])).toBe('atencao');
    expect(calcularStatusChecklist(['atencao', 'critico', 'ok'])).toBe('critico');
  });
  it('conta severidades e monta o caminho no Storage', () => {
    expect(contarSeveridades(['ok', 'atencao', 'ok', 'critico'])).toEqual({ ok: 2, atencao: 1, critico: 1 });
    expect(caminhoFotoChecklist('f1', 'c1', 'motor')).toBe('f1/c1/motor.jpg');
  });
});
