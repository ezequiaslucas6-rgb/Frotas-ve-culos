import { describe, expect, it } from 'vitest';
import { classificarFalha, ErroIA, extrairJson } from './gemini-resposta';
import { criarCache, criarLimitador } from './limite';

describe('resposta do Gemini', () => {
  it('lê o JSON do texto (ignorando "pensamentos" e cercas de código)', () => {
    const corpo = { candidates: [{ content: { parts: [{ text: 'pensando…', thought: true }, { text: '```json\n{"litros": 45.32}\n```' }] } }] };
    expect(extrairJson(corpo)).toEqual({ litros: 45.32 });
  });

  it('sem texto ou bloqueado vira resposta inválida', () => {
    expect(() => extrairJson({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })).toThrow(ErroIA);
    expect(() => extrairJson({ promptFeedback: { blockReason: 'OTHER' } })).toThrow(/entender a leitura/);
    expect(() => extrairJson({ candidates: [{ content: { parts: [{ text: 'não é json' }] } }] })).toThrow(ErroIA);
  });

  it('classifica as falhas da API', () => {
    expect(classificarFalha(429, 'RESOURCE_EXHAUSTED').codigo).toBe('limite');
    expect(classificarFalha(404, 'models/x is not found').codigo).toBe('modelo');
    expect(classificarFalha(400, 'API key not valid. Please pass a valid API key.').codigo).toBe('chave_invalida');
    expect(classificarFalha(403, 'PERMISSION_DENIED').codigo).toBe('chave_invalida');
    expect(classificarFalha(400, 'User location is not supported for the API use.').codigo).toBe('regiao');
    expect(classificarFalha(503, 'overloaded').codigo).toBe('indisponivel');
    expect(classificarFalha(400, 'Invalid JSON payload').codigo).toBe('resposta_invalida');
  });
});

describe('limite de uso e cache', () => {
  it('por minuto e por dia, separado por usuário', () => {
    const l = criarLimitador({ porMinuto: 2, porDia: 3 });
    const t = 1_000_000;
    expect([l.permitir('a', t), l.permitir('a', t + 1), l.permitir('a', t + 2)]).toEqual([true, true, false]);
    expect(l.permitir('b', t)).toBe(true);
    expect(l.permitir('a', t + 61_000)).toBe(true); // passou o minuto
    expect(l.permitir('a', t + 122_000)).toBe(false); // estourou o dia
    expect(l.permitir('a', t + 86_400_000 + 5)).toBe(true); // dia seguinte
  });

  it('cache expira e não passa do máximo', () => {
    const c = criarCache<number>({ validadeMs: 1000, maximo: 2 });
    c.guardar('x', 1, 0);
    c.guardar('y', 2, 0);
    c.guardar('z', 3, 0);
    expect([c.ler('x', 10), c.ler('y', 10), c.ler('z', 10)]).toEqual([undefined, 2, 3]);
    expect(c.ler('y', 2000)).toBeUndefined();
  });
});
