import { describe, expect, it } from 'vitest';
import { inicioDaBusca, inicioDaSemana, periodosCobranca, resumoCobranca, situacaoCobranca } from './cobranca';

describe('períodos da cobrança', () => {
  it('semana começa na segunda (domingo pertence à semana que termina)', () => {
    expect(inicioDaSemana('2026-10-05')).toBe('2026-10-05'); // segunda
    expect(inicioDaSemana('2026-10-08')).toBe('2026-10-05'); // quinta
    expect(inicioDaSemana('2026-10-11')).toBe('2026-10-05'); // domingo
    expect(inicioDaSemana('2026-11-01')).toBe('2026-10-26'); // domingo, semana vinda do mês anterior
  });

  it('busca desde o início da semana quando ela começou no mês anterior', () => {
    const p = periodosCobranca('2026-11-03');
    expect(p).toEqual({ diario: '2026-11-03', semanal: '2026-11-02', mensal: '2026-11-01' });
    expect(inicioDaBusca(p)).toBe('2026-11-01');
    expect(inicioDaBusca(periodosCobranca('2026-10-01'))).toBe('2026-09-28');
  });
});

describe('situação por veículo', () => {
  const hoje = '2026-10-08'; // quinta; semana desde 05/10
  const veiculos = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

  it('diário de hoje; semanal da semana; mensal do mês (fuso de São Paulo)', () => {
    const s = situacaoCobranca(
      veiculos.map((v) => v.id),
      [
        { veiculo_id: 'A', tipo: 'diario', data_envio: '2026-10-08T11:00:00Z' },
        { veiculo_id: 'A', tipo: 'semanal', data_envio: '2026-10-06T11:00:00Z' },
        // 02:30Z do dia 08 ainda é dia 07 em São Paulo: não vale como diário de hoje
        { veiculo_id: 'B', tipo: 'diario', data_envio: '2026-10-08T02:30:00Z' },
        { veiculo_id: 'C', tipo: 'mensal', data_envio: '2026-10-02T12:00:00Z' },
      ],
      hoje,
    );
    expect(s.get('A')).toEqual({ diario: true, semanal: true, mensal: false });
    expect(s.get('B')).toEqual({ diario: false, semanal: false, mensal: false });
    // mensal de 02/10 (semana anterior): vale para o mês, não para esta semana nem para hoje
    expect(s.get('C')).toEqual({ diario: false, semanal: false, mensal: true });
  });

  it('checklist maior cobre os menores do mesmo período', () => {
    const s = situacaoCobranca(['A', 'B'], [
      { veiculo_id: 'A', tipo: 'mensal', data_envio: '2026-10-08T12:00:00Z' },
      { veiculo_id: 'B', tipo: 'semanal', data_envio: '2026-10-08T12:00:00Z' },
    ], hoje);
    expect(s.get('A')).toEqual({ diario: true, semanal: true, mensal: true });
    expect(s.get('B')).toEqual({ diario: true, semanal: true, mensal: false });
  });

  it('resumo: feitos de total e a lista de pendentes', () => {
    const s = situacaoCobranca(['A', 'B', 'C'], [{ veiculo_id: 'A', tipo: 'diario', data_envio: '2026-10-08T12:00:00Z' }], hoje);
    const r = resumoCobranca(veiculos, s);
    expect(r.diario).toEqual({ feitos: 1, total: 3, pendentes: [{ id: 'B' }, { id: 'C' }] });
    expect(r.mensal.feitos).toBe(0);
  });
});
