import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { ehFalhaDeRede, processarEnvio, type EnvioPendente } from './fila';

// Aqui não há IndexedDB (ambiente node): a fila tolera isso e o envio segue direto,
// como num navegador sem armazenamento local.
const supabase = {} as SupabaseClient<Database>;
const envio = (id = 'c1'): EnvioPendente => ({
  checklistId: id,
  userId: 'u1',
  placa: 'ABC1D23',
  payload: { id, itens: [{ fotoPath: `f1/${id}/pneu.jpg` }] },
  criadoEm: 0,
});

describe('falha de rede x recusa', () => {
  it('sem status, status 0 ou 5xx é rede (tenta de novo depois); 4xx é recusa', () => {
    expect(ehFalhaDeRede(new TypeError('Failed to fetch'))).toBe(true);
    expect(ehFalhaDeRede({ status: 0 })).toBe(true);
    expect(ehFalhaDeRede({ statusCode: '503' })).toBe(true);
    expect(ehFalhaDeRede({ status: 400 })).toBe(false);
    expect(ehFalhaDeRede({ statusCode: '403' })).toBe(false);
  });
});

describe('processarEnvio', () => {
  it('enviado: devolve o id e o status do checklist', async () => {
    const salvar = vi.fn().mockResolvedValue({ ok: true, id: 'c1', status: 'critico' });
    expect(await processarEnvio(envio(), supabase, salvar)).toEqual({ estado: 'enviado', id: 'c1', status: 'critico' });
    expect(salvar).toHaveBeenCalledWith(envio().payload);
  });

  it('a chamada falhou (sem rede, servidor fora): continua aguardando', async () => {
    const salvar = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await processarEnvio(envio(), supabase, salvar)).toEqual({ estado: 'aguardando' });
  });

  it('o servidor recusou: devolve o motivo (não tenta sozinho de novo)', async () => {
    const salvar = vi.fn().mockResolvedValue({ ok: false, message: 'KM menor que o último registrado.' });
    expect(await processarEnvio(envio(), supabase, salvar)).toEqual({ estado: 'recusado', mensagem: 'KM menor que o último registrado.' });
  });

  it('o mesmo checklist não é enviado duas vezes ao mesmo tempo', async () => {
    let terminar!: (v: unknown) => void;
    const salvar = vi.fn().mockReturnValue(new Promise((ok) => (terminar = ok)));
    const primeiro = processarEnvio(envio(), supabase, salvar);
    expect(await processarEnvio(envio(), supabase, salvar)).toEqual({ estado: 'aguardando' });
    await vi.waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    terminar({ ok: true, id: 'c1', status: 'ok' });
    expect((await primeiro).estado).toBe('enviado');
    expect(salvar).toHaveBeenCalledTimes(1);
  });
});
