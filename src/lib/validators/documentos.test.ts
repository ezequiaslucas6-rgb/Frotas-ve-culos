import { describe, expect, it } from 'vitest';
import {
  formatCpf,
  formatPlaca,
  formatWhatsapp,
  isValidCnh,
  isValidCpf,
  isValidPlaca,
  normalizePlaca,
  normalizeWhatsapp,
  whatsappLink,
} from './documentos';

describe('CPF', () => {
  it('aceita CPFs válidos (com e sem máscara)', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11144477735')).toBe(true);
  });
  it('rejeita dígito verificador errado, tamanho errado e sequências repetidas', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('1234567890')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });
});

describe('CNH', () => {
  it('aceita CNH válida', () => {
    expect(isValidCnh('22522791508')).toBe(true);
  });
  it('rejeita dígito verificador errado, tamanho errado e sequências repetidas', () => {
    expect(isValidCnh('22522791509')).toBe(false);
    expect(isValidCnh('2252279150')).toBe(false);
    expect(isValidCnh('00000000000')).toBe(false);
  });
});

describe('Placa', () => {
  it('aceita padrão antigo e Mercosul, com ou sem hífen/minúsculas', () => {
    expect(isValidPlaca('ABC-1234')).toBe(true);
    expect(isValidPlaca('abc1d23')).toBe(true);
  });
  it('rejeita formatos inválidos', () => {
    expect(isValidPlaca('AB12345')).toBe(false);
    expect(isValidPlaca('ABCD123')).toBe(false);
  });
  it('normaliza e formata', () => {
    expect(normalizePlaca('abc-1234')).toBe('ABC1234');
    expect(formatPlaca('abc1234')).toBe('ABC-1234');
    expect(formatPlaca('ABC1D23')).toBe('ABC1D23');
  });
});

describe('WhatsApp', () => {
  it('normaliza variações para 55 + DDD + número', () => {
    expect(normalizeWhatsapp('(11) 99999-0001')).toBe('5511999990001');
    expect(normalizeWhatsapp('+55 11 99999-0001')).toBe('5511999990001');
    expect(normalizeWhatsapp('11999990001')).toBe('5511999990001');
    expect(normalizeWhatsapp('(21) 8888-7777')).toBe('552188887777');
  });
  it('rejeita DDD inválido, celular sem 9 e tamanhos errados', () => {
    expect(normalizeWhatsapp('(01) 99999-0001')).toBeNull();
    expect(normalizeWhatsapp('(11) 89999-0001')).toBeNull();
    expect(normalizeWhatsapp('99999-0001')).toBeNull();
    expect(normalizeWhatsapp('')).toBeNull();
  });
  it('gera o link wa.me', () => {
    expect(whatsappLink('5511999990001')).toBe('https://wa.me/5511999990001');
    expect(whatsappLink('+55 (11) 99999-0001', 'Olá, tudo bem?')).toBe(
      'https://wa.me/5511999990001?text=Ol%C3%A1%2C%20tudo%20bem%3F',
    );
  });
});

describe('máscaras', () => {
  it('formata CPF e WhatsApp progressivamente', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCpf('5299')).toBe('529.9');
    expect(formatWhatsapp('11999990001')).toBe('(11) 99999-0001');
    expect(formatWhatsapp('1188887777')).toBe('(11) 8888-7777');
    expect(formatWhatsapp('5511999990001')).toBe('(11) 99999-0001');
    expect(formatWhatsapp('1')).toBe('(1');
  });
});
