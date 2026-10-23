import { describe, expect, it } from 'vitest';
import { momentoDeDisparo } from './janela';

// Pimenta Bueno = UTC−4 (sem horário de verão): 08:00 lá = 12:00 UTC
const utc = (hhmm: string) => new Date(`2026-10-22T${hhmm}:00Z`);

describe('quando o lembrete sai (horário de Pimenta Bueno)', () => {
  it('08:00 sai o do motorista; 08:30, o do supervisor', () => {
    expect(momentoDeDisparo(utc('12:00'))).toBe('0800');
    expect(momentoDeDisparo(utc('12:30'))).toBe('0830');
  });

  it('antes da hora e fora das duas janelas: nada', () => {
    expect(momentoDeDisparo(utc('11:59'))).toBeNull();
    expect(momentoDeDisparo(utc('12:15'))).toBeNull(); // a tolerância do 08:00 acabou
    expect(momentoDeDisparo(utc('12:29'))).toBeNull();
    expect(momentoDeDisparo(utc('12:45'))).toBeNull();
    expect(momentoDeDisparo(utc('00:00'))).toBeNull();
  });

  it('servidor fora do ar no minuto exato: ainda sai até 15 minutos depois', () => {
    expect(momentoDeDisparo(utc('12:01'))).toBe('0800');
    expect(momentoDeDisparo(utc('12:14'))).toBe('0800');
    expect(momentoDeDisparo(utc('12:31'))).toBe('0830');
    expect(momentoDeDisparo(utc('12:44'))).toBe('0830');
  });

  it('usa o horário de Pimenta Bueno, não o do servidor: 08:00 em UTC não é a hora', () => {
    expect(momentoDeDisparo(utc('08:00'))).toBeNull(); // 04:00 em Porto Velho
    expect(momentoDeDisparo(utc('11:00'))).toBeNull(); // 07:00
  });
});
