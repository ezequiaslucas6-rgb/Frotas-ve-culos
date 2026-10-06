import { describe, expect, it } from 'vitest';
import { lembreteSupervisor, lembretesMotorista, type VeiculoLembrete } from './lembretes';

const v = (extra: Partial<VeiculoLembrete>): VeiculoLembrete => ({ id: 'V1', placa: 'ABC1D23', semanal: 'feito', diaria: 'aguardando', parado: false, ...extra });

describe('lembrete do motorista (08:00)', () => {
  it('diário a fazer até 08:30; nada se já fez', () => {
    expect(lembretesMotorista([v({})])).toEqual([
      {
        id: 'diario-V1',
        titulo: 'Bom dia! Hora do checklist',
        texto: 'Faça o checklist diário do ABC1D23 até as 08:30, antes de sair.',
        url: '/checklists/novo?veiculo=V1&tipo=diario',
      },
    ]);
    expect(lembretesMotorista([v({ diaria: 'feito' })])).toEqual([]);
  });

  it('no fim de semana lembra do semanal; atrasado avisa que não está liberado; parado por avaria não recebe', () => {
    expect(lembretesMotorista([v({ semanal: 'fazer' })])[0]).toMatchObject({ titulo: 'Hoje é dia do checklist semanal', url: '/checklists/novo?veiculo=V1&tipo=semanal' });
    expect(lembretesMotorista([v({ semanal: 'atrasado' })])[0]).toMatchObject({ titulo: 'ABC1D23 não liberado' });
    expect(lembretesMotorista([v({ parado: true })])).toEqual([]);
  });
});

describe('resumo do supervisor (08:30)', () => {
  it('quantos fizeram e quantos esperam a decisão', () => {
    const [n] = lembreteSupervisor([
      v({ id: 'A', diaria: 'feito' }),
      v({ id: 'B', diaria: 'decidir' }),
      v({ id: 'C', diaria: 'decidir', semanal: 'atrasado' }),
      v({ id: 'D', parado: true }),
    ]);
    expect(n).toEqual({
      id: 'resumo-diario',
      titulo: 'Checklist de hoje: decisão pendente',
      texto: '1 de 3 veículos fizeram o checklist diário. 2 sem checklist: decida se estão liberados hoje. 1 não liberado(s) por falta do semanal.',
      url: '/checklists/hoje',
    });
    expect(lembreteSupervisor([v({ diaria: 'feito' })])[0]!.titulo).toBe('Checklist de hoje: tudo em dia');
    expect(lembreteSupervisor([])).toEqual([]);
  });
});
