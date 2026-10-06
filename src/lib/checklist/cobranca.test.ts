import { describe, expect, it } from 'vitest';
import {
  diasDoSemanal,
  inicioDaBusca,
  inicioDoCicloSemanal,
  periodosCobranca,
  resumoCobranca,
  situacaoCobranca,
  situacaoDaView,
  situacaoDiaria,
  situacaoSemanal,
} from './cobranca';

describe('períodos da cobrança', () => {
  it('o ciclo semanal começa no sábado (sábado e domingo são os dias do semanal)', () => {
    expect(inicioDoCicloSemanal('2026-10-10')).toBe('2026-10-10'); // sábado
    expect(inicioDoCicloSemanal('2026-10-11')).toBe('2026-10-10'); // domingo
    expect(inicioDoCicloSemanal('2026-10-12')).toBe('2026-10-10'); // segunda
    expect(inicioDoCicloSemanal('2026-10-16')).toBe('2026-10-10'); // sexta
    expect(inicioDoCicloSemanal('2026-10-17')).toBe('2026-10-17'); // sábado seguinte
  });

  it('busca desde o sábado quando o ciclo começou no mês anterior', () => {
    const p = periodosCobranca('2026-11-03'); // terça
    expect(p).toEqual({ diario: '2026-11-03', semanal: '2026-10-31', mensal: '2026-11-01' });
    expect(inicioDaBusca(p)).toBe('2026-10-31');
  });

  it('dias do semanal: os deste fim de semana ou os do próximo', () => {
    expect(diasDoSemanal('2026-10-11')).toEqual({ sabado: '2026-10-10', domingo: '2026-10-11' });
    expect(diasDoSemanal('2026-10-13')).toEqual({ sabado: '2026-10-17', domingo: '2026-10-18' });
  });
});

describe('situação por veículo', () => {
  const hoje = '2026-10-15'; // quinta; ciclo desde sábado 10/10
  const veiculos = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

  it('diário de hoje; semanal desde sábado; mensal do mês (horário de Pimenta Bueno)', () => {
    const s = situacaoCobranca(
      veiculos.map((v) => v.id),
      [
        { veiculo_id: 'A', tipo: 'diario', data_envio: '2026-10-15T11:00:00Z' },
        { veiculo_id: 'A', tipo: 'semanal', data_envio: '2026-10-11T13:00:00Z' },
        // 03:30Z do dia 15 ainda é dia 14 em Pimenta Bueno (UTC−4): não vale como diário de hoje
        { veiculo_id: 'B', tipo: 'diario', data_envio: '2026-10-15T03:30:00Z' },
        // semanal da sexta 09/10 é do ciclo anterior
        { veiculo_id: 'C', tipo: 'semanal', data_envio: '2026-10-09T12:00:00Z' },
      ],
      hoje,
    );
    expect(s.get('A')).toEqual({ diario: true, semanal: true, mensal: false });
    expect(s.get('B')).toEqual({ diario: false, semanal: false, mensal: false });
    expect(s.get('C')).toEqual({ diario: false, semanal: false, mensal: false });
  });

  it('checklist maior cobre os menores do mesmo período', () => {
    const s = situacaoCobranca(
      ['A', 'B'],
      [
        { veiculo_id: 'A', tipo: 'mensal', data_envio: '2026-10-15T12:00:00Z' },
        { veiculo_id: 'B', tipo: 'semanal', data_envio: '2026-10-15T12:00:00Z' },
      ],
      hoje,
    );
    expect(s.get('A')).toEqual({ diario: true, semanal: true, mensal: true });
    expect(s.get('B')).toEqual({ diario: true, semanal: true, mensal: false });
  });

  it('a mesma situação a partir da view do painel', () => {
    expect(
      situacaoDaView(
        { ultimo_checklist_em: '2026-10-15T12:00:00Z', ultimo_semanal_em: '2026-10-10T15:00:00Z', ultimo_mensal_em: '2026-09-30T15:00:00Z' },
        hoje,
      ),
    ).toEqual({ diario: true, semanal: true, mensal: false });
    expect(situacaoDaView({ ultimo_checklist_em: null }, hoje)).toEqual({ diario: false, semanal: false, mensal: false });
  });

  it('resumo: feitos de total e a lista de pendentes', () => {
    const s = situacaoCobranca(['A', 'B', 'C'], [{ veiculo_id: 'A', tipo: 'diario', data_envio: '2026-10-15T12:00:00Z' }], hoje);
    const r = resumoCobranca(veiculos, s);
    expect(r.diario).toEqual({ feitos: 1, total: 3, pendentes: [{ id: 'B' }, { id: 'C' }] });
    expect(r.mensal.feitos).toBe(0);
  });
});

describe('semanal obrigatório no sábado ou domingo', () => {
  it('no fim de semana, sem fazer: é para fazer (ainda liberado)', () => {
    expect(situacaoSemanal(false, '2026-10-17')).toBe('fazer');
    expect(situacaoSemanal(false, '2026-10-18')).toBe('fazer');
  });

  it('de segunda a sexta sem o do fim de semana: atrasado (não liberado até fazer)', () => {
    expect(situacaoSemanal(false, '2026-10-19')).toBe('atrasado');
    expect(situacaoSemanal(false, '2026-10-23')).toBe('atrasado');
    expect(situacaoSemanal(true, '2026-10-19')).toBe('feito');
  });

  it('não bloqueia antes do primeiro fim de semana da regra nem veículo cadastrado depois do sábado', () => {
    expect(situacaoSemanal(false, '2026-10-07')).toBe('proximo'); // ciclo de 03/10: antes da regra
    expect(situacaoSemanal(false, '2026-10-12', '2026-10-11T15:00:00Z')).toBe('proximo');
    expect(situacaoSemanal(false, '2026-10-12', '2026-10-01T15:00:00Z')).toBe('atrasado');
  });
});

describe('diário com prazo às 08:30', () => {
  // 12:29Z = 08:29 em Pimenta Bueno; 12:31Z = 08:31
  it('antes das 08:30 aguarda; depois, o supervisor decide', () => {
    expect(situacaoDiaria(false, null, '2026-10-15T12:29:00Z')).toBe('aguardando');
    expect(situacaoDiaria(false, null, '2026-10-15T12:31:00Z')).toBe('decidir');
  });

  it('feito vale mais que a decisão; a decisão vale enquanto não fizer', () => {
    expect(situacaoDiaria(true, false, '2026-10-15T15:00:00Z')).toBe('feito');
    expect(situacaoDiaria(false, true, '2026-10-15T15:00:00Z')).toBe('liberado');
    expect(situacaoDiaria(false, false, '2026-10-15T09:00:00Z')).toBe('nao_liberado');
  });
});
