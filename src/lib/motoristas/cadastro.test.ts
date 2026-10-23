import { describe, expect, it } from 'vitest';
import { motoristaSchemaPara } from '@/lib/schemas';

const FILIAL = '6f1c1a4e-8a3b-4c7d-9e2f-0a1b2c3d4e5f';
const minimo = { filial_id: FILIAL, nome: 'Motorista Teste 1', email: 'motorista1@teste.com' };

describe('cadastro do motorista', () => {
  it('fase de testes: só nome e e-mail; o resto fica vazio', () => {
    const r = motoristaSchemaPara(false).safeParse(minimo);
    expect(r.success).toBe(true);
    for (const campo of ['cpf', 'whatsapp', 'cnh', 'cnh_categoria', 'cnh_validade'] as const) expect(r.data?.[campo]).toBeUndefined();
  });

  it('fase de testes: aceita números fictícios (sem dígito verificador)', () => {
    const r = motoristaSchemaPara(false).safeParse({ ...minimo, cpf: '111.111.111-11', cnh: '12345678901', whatsapp: '(69) 99999-0000' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ cpf: '11111111111', cnh: '12345678901', whatsapp: '5569999990000' });
  });

  it('fase de testes: preenchido, o formato ainda é conferido (o banco exige 11 dígitos)', () => {
    const r = motoristaSchemaPara(false).safeParse({ ...minimo, cpf: '123', whatsapp: '123' });
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors).sort()).toEqual(['cpf', 'whatsapp']);
  });

  it('obrigatórios (sistema completo): exige CPF, WhatsApp, CNH, categoria e validade reais', () => {
    const r = motoristaSchemaPara(true).safeParse({ ...minimo, cpf: '111.111.111-11', cnh: '12345678901' });
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors).sort()).toEqual(['cnh', 'cnh_categoria', 'cnh_validade', 'cpf', 'whatsapp']);
  });
});
