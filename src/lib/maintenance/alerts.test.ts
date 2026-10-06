import { describe, expect, it } from 'vitest';
import { avaliarSaudeVeiculo, calcularAlertaRevisao, proximaRevisao } from './alerts';

const HOJE = '2026-03-10';
const plano = (over: Partial<Parameters<typeof calcularAlertaRevisao>[0]> = {}) => ({
  kmAtual: 50_000,
  proximaRevisaoKm: 60_000,
  proximaRevisaoData: '2026-09-01',
  ...over,
});

describe('calcularAlertaRevisao', () => {
  it('ok quando KM e prazo estão folgados', () => {
    const r = calcularAlertaRevisao(plano(), HOJE);
    expect(r).toMatchObject({ nivel: 'ok', motivos: [], kmRestantes: 10_000, diasRestantes: 175 });
  });

  it('próximo por KM (<= 1000 km)', () => {
    expect(calcularAlertaRevisao(plano({ kmAtual: 59_000 }), HOJE)).toMatchObject({ nivel: 'proximo', motivos: ['km'] });
  });

  it('vencido por KM (atingiu ou passou)', () => {
    expect(calcularAlertaRevisao(plano({ kmAtual: 60_000 }), HOJE).nivel).toBe('vencido');
    expect(calcularAlertaRevisao(plano({ kmAtual: 61_500 }), HOJE)).toMatchObject({ nivel: 'vencido', kmRestantes: -1500 });
  });

  it('próximo por período (<= 15 dias)', () => {
    expect(calcularAlertaRevisao(plano({ proximaRevisaoData: '2026-03-25' }), HOJE)).toMatchObject({
      nivel: 'proximo',
      motivos: ['periodo'],
      diasRestantes: 15,
    });
  });

  it('vencido por período (hoje ou antes)', () => {
    expect(calcularAlertaRevisao(plano({ proximaRevisaoData: '2026-03-10' }), HOJE).nivel).toBe('vencido');
    expect(calcularAlertaRevisao(plano({ proximaRevisaoData: '2026-02-01' }), HOJE).nivel).toBe('vencido');
  });

  it('vale o pior dos dois critérios e lista ambos os motivos', () => {
    const r = calcularAlertaRevisao(plano({ kmAtual: 59_500, proximaRevisaoData: '2026-03-01' }), HOJE);
    expect(r.nivel).toBe('vencido');
    expect(r.motivos).toEqual(['km', 'periodo']);
  });

  it('sem plano de revisão => ok', () => {
    expect(calcularAlertaRevisao({ kmAtual: 1, proximaRevisaoKm: null, proximaRevisaoData: null }, HOJE)).toEqual({
      nivel: 'ok',
      motivos: [],
      kmRestantes: null,
      diasRestantes: null,
    });
  });
});

describe('proximaRevisao', () => {
  it('soma os intervalos ao KM e à data da preventiva', () => {
    expect(proximaRevisao({ kmRegistro: 52_300, dataManutencao: '2026-01-31', intervaloKm: 10_000, intervaloDias: 30 })).toEqual({
      km: 62_300,
      data: '2026-03-02',
    });
  });
});

describe('avaliarSaudeVeiculo', () => {
  const base = { ultimoChecklistStatus: null, ultimoChecklistEm: null, ultimaCorretivaEm: null, alerta: 'ok' as const };

  it('liberado sem pendências', () => {
    expect(avaliarSaudeVeiculo(base)).toEqual({ saude: 'liberado', motivos: [], naoLiberado: false, bloqueio: null });
    expect(avaliarSaudeVeiculo({ ...base, ultimoChecklistStatus: 'ok', ultimoChecklistEm: '2026-03-01T12:00:00Z' }).saude).toBe('liberado');
  });

  it('checklist crítico => manutenção; atenção => atenção', () => {
    expect(avaliarSaudeVeiculo({ ...base, ultimoChecklistStatus: 'critico', ultimoChecklistEm: '2026-03-01T12:00:00Z' }).saude).toBe('manutencao');
    expect(avaliarSaudeVeiculo({ ...base, ultimoChecklistStatus: 'atencao', ultimoChecklistEm: '2026-03-01T12:00:00Z' }).saude).toBe('atencao');
  });

  it('corretiva na data do checklist ou depois resolve a pendência; anterior não', () => {
    const critico = { ...base, ultimoChecklistStatus: 'critico' as const, ultimoChecklistEm: '2026-03-05T15:00:00Z' };
    expect(avaliarSaudeVeiculo({ ...critico, ultimaCorretivaEm: '2026-03-05' }).saude).toBe('liberado');
    expect(avaliarSaudeVeiculo({ ...critico, ultimaCorretivaEm: '2026-03-08' }).saude).toBe('liberado');
    expect(avaliarSaudeVeiculo({ ...critico, ultimaCorretivaEm: '2026-03-04' }).saude).toBe('manutencao');
  });

  it('usa o fuso de São Paulo para a data do checklist (02:00Z ainda é dia anterior no Brasil)', () => {
    const critico = { ...base, ultimoChecklistStatus: 'critico' as const, ultimoChecklistEm: '2026-03-06T02:00:00Z' };
    expect(avaliarSaudeVeiculo({ ...critico, ultimaCorretivaEm: '2026-03-05' }).saude).toBe('liberado');
  });

  it('revisão vencida => manutenção; próxima => atenção; pior vence', () => {
    expect(avaliarSaudeVeiculo({ ...base, alerta: 'vencido' })).toMatchObject({ saude: 'manutencao' });
    expect(avaliarSaudeVeiculo({ ...base, alerta: 'proximo' })).toMatchObject({ saude: 'atencao' });
    const r = avaliarSaudeVeiculo({ ...base, alerta: 'proximo', ultimoChecklistStatus: 'critico', ultimoChecklistEm: '2026-03-01T12:00:00Z' });
    expect(r.saude).toBe('manutencao');
    expect(r.motivos).toHaveLength(2);
  });

  describe('checklist semanal e diário', () => {
    it('semanal atrasado (seg–sex sem o do fim de semana) => não liberado', () => {
      const r = avaliarSaudeVeiculo({ ...base, semanal: 'atrasado' });
      expect(r).toMatchObject({ saude: 'manutencao', naoLiberado: true, bloqueio: 'semanal' });
      expect(r.motivos).toContain('Não liberado: checklist semanal do fim de semana não feito');
    });

    it('sábado ou domingo sem o semanal => atenção (ainda liberado)', () => {
      expect(avaliarSaudeVeiculo({ ...base, semanal: 'fazer' })).toMatchObject({ saude: 'atencao', naoLiberado: false, bloqueio: null });
    });

    it('sem checklist diário e não liberado pelo supervisor => não liberado hoje', () => {
      expect(avaliarSaudeVeiculo({ ...base, diaria: 'nao_liberado' })).toMatchObject({ saude: 'manutencao', naoLiberado: true, bloqueio: 'diario' });
      expect(avaliarSaudeVeiculo({ ...base, diaria: 'decidir' })).toMatchObject({ saude: 'liberado', naoLiberado: false });
    });

    it('a avaria tem prioridade como motivo', () => {
      expect(avaliarSaudeVeiculo({ ...base, bloqueado: true, semanal: 'atrasado', diaria: 'nao_liberado' }).bloqueio).toBe('avaria');
    });
  });

  describe('avaria crítica com bloqueio (não liberado)', () => {
    const critico = { ...base, ultimoChecklistStatus: 'critico' as const, ultimoChecklistEm: '2026-03-05T15:00:00Z' };

    it('bloqueio aberto => não liberado (vermelho), com um único motivo', () => {
      const r = avaliarSaudeVeiculo({ ...critico, bloqueado: true, manutencoesAbertas: 1 });
      expect(r).toEqual({ saude: 'manutencao', motivos: ['Não liberado: avaria crítica no checklist'], naoLiberado: true, bloqueio: 'avaria' });
    });

    it('liberado pelo responsável depois do checklist, conserto pendente => atenção', () => {
      const r = avaliarSaudeVeiculo({ ...critico, ultimaLiberacaoEm: '2026-03-05T18:00:00Z', manutencoesAbertas: 1 });
      expect(r).toEqual({ saude: 'atencao', motivos: ['Conserto pendente'], naoLiberado: false, bloqueio: null });
    });

    it('liberação ANTES do checklist crítico não vale para ele', () => {
      expect(avaliarSaudeVeiculo({ ...critico, ultimaLiberacaoEm: '2026-03-01T10:00:00Z' }).saude).toBe('manutencao');
    });

    it('conserto concluído e nada pendente => liberado', () => {
      expect(avaliarSaudeVeiculo({ ...critico, ultimaCorretivaEm: '2026-03-06', ultimaLiberacaoEm: '2026-03-06T10:00:00Z', manutencoesAbertas: 0 }).saude).toBe('liberado');
    });
  });
});
