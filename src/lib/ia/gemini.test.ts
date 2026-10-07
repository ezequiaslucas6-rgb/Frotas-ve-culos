import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESPERA_ANTES_DO_RESERVA_MS, esquecerFormasAceitas, gerarJsonDeImagem, modelosGemini } from './gemini';
import { paraJsonSchema, proximaForma } from './gemini-formas';

const ok = (json: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: 'STOP' }] }), { status: 200 });
const erro = (status: number, message: string) => new Response(JSON.stringify({ error: { code: status, message, status: 'INVALID_ARGUMENT' } }), { status });
const SCHEMA = { type: 'OBJECT', properties: { litros: { type: 'NUMBER', nullable: true } } };
const chamar = () => gerarJsonDeImagem({ imagemBase64: 'AAAA', mimeType: 'image/jpeg', instrucoes: 'leia', schema: SCHEMA });

/** o que foi pedido em cada chamada: modelo, raciocínio e formato da resposta */
const pedidos = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map(([url, init]) => {
    const corpo = JSON.parse((init as RequestInit).body as string);
    const c = corpo.generationConfig;
    const formato = c.responseSchema ? 'responseSchema' : c.responseJsonSchema ? 'responseJsonSchema' : 'json';
    return {
      modelo: decodeURIComponent(String(url).split('/models/')[1]!.split(':')[0]!),
      pensar: c.thinkingConfig ?? {},
      formato,
      texto: corpo.contents[0].parts[1].text as string,
    };
  });

describe('chamada ao Gemini', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'teste');
    vi.stubEnv('GEMINI_MODELOS', 'flash,lite');
    esquecerFormasAceitas();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('os "-latest" entram sempre no fim da lista (modelo configurado desligado não para a leitura)', () => {
    expect(modelosGemini()).toEqual(['flash', 'lite', 'gemini-flash-latest', 'gemini-flash-lite-latest']);
    vi.stubEnv('GEMINI_MODELOS', '');
    expect(modelosGemini()).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest']);
  });

  it('pede o mínimo de "raciocínio", com o schema, e devolve o JSON', async () => {
    const f = vi.fn().mockResolvedValue(ok({ litros: 40.35 }));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).resolves.toMatchObject({ modelo: 'flash', json: { litros: 40.35 } });
    expect(pedidos(f)).toMatchObject([{ modelo: 'flash', pensar: { thinkingLevel: 'minimal' }, formato: 'responseSchema' }]);
  });

  it('modelo 3.x que recusa "minimal": usa "low" e lembra disso', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(erro(400, 'Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.'))
      .mockResolvedValueOnce(ok({ litros: 1 }));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).resolves.toMatchObject({ modelo: 'flash' });
    expect(pedidos(f).map((p) => p.pensar)).toEqual([{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }]);
    // a próxima leitura já vai direto na forma aceita
    f.mockResolvedValueOnce(ok({ litros: 2 }));
    await chamar();
    expect(pedidos(f).at(-1)).toMatchObject({ modelo: 'flash', pensar: { thinkingLevel: 'low' }, formato: 'responseSchema' });
  });

  it('modelo 2.x (não conhece thinkingLevel): chega ao thinkingBudget 0', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(erro(400, 'Invalid JSON payload received. Unknown name "thinkingLevel" at \'generation_config.thinking_config\'.'))
      .mockResolvedValueOnce(erro(400, 'Invalid JSON payload received. Unknown name "thinkingLevel" at \'generation_config.thinking_config\'.'))
      .mockResolvedValueOnce(ok({ litros: 1 }));
    vi.stubGlobal('fetch', f);
    await chamar();
    expect(pedidos(f).map((p) => p.pensar)).toEqual([{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingBudget: 0 }]);
  });

  it('schema recusado: passa para responseJsonSchema sem mexer no raciocínio', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(erro(400, 'Invalid JSON payload received. Unknown name "responseSchema" at \'generation_config\': Cannot find field.'))
      .mockResolvedValueOnce(ok({ litros: 1 }));
    vi.stubGlobal('fetch', f);
    await chamar();
    expect(pedidos(f).map(({ pensar, formato }) => ({ pensar, formato }))).toEqual([
      { pensar: { thinkingLevel: 'minimal' }, formato: 'responseSchema' },
      { pensar: { thinkingLevel: 'minimal' }, formato: 'responseJsonSchema' },
    ]);
  });

  it('último recurso: só JSON, com o formato descrito no texto', async () => {
    const f = vi.fn().mockResolvedValueOnce(erro(400, 'responseSchema: bad')).mockResolvedValueOnce(erro(400, 'responseJsonSchema: bad')).mockResolvedValueOnce(ok({ litros: 1 }));
    vi.stubGlobal('fetch', f);
    await chamar();
    const ultimo = pedidos(f).at(-1)!;
    expect(ultimo.formato).toBe('json');
    expect(ultimo.texto).toContain('"litros":{"type":["number","null"]}');
  });

  it('limite no primeiro modelo: usa o próximo', async () => {
    const f = vi.fn().mockResolvedValueOnce(erro(429, 'quota')).mockResolvedValueOnce(ok({ litros: 3 }));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).resolves.toMatchObject({ modelo: 'lite' });
  });

  it('modelo lento: o próximo começa em paralelo e vale a primeira resposta', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let cancelado = false;
      const f = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (url.includes('/models/flash:')) {
          // não responde; só termina quando a leitura é cancelada
          return new Promise((_, rejeitar) =>
            init.signal!.addEventListener('abort', () => {
              cancelado = true;
              rejeitar(new DOMException('abortado', 'AbortError'));
            }),
          );
        }
        return Promise.resolve(ok({ litros: 4 }));
      });
      vi.stubGlobal('fetch', f);
      const leitura = chamar();
      await vi.advanceTimersByTimeAsync(ESPERA_ANTES_DO_RESERVA_MS - 1);
      expect(f).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(leitura).resolves.toMatchObject({ modelo: 'lite', json: { litros: 4 } });
      expect(cancelado).toBe(true); // o lento é cancelado
    } finally {
      vi.useRealTimers();
    }
  });

  it('recusado em todas as formas e modelos: erro "recusado" com o motivo do Google', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => erro(400, 'Request contains an invalid argument.')));
    await expect(chamar()).rejects.toMatchObject({
      codigo: 'recusado',
      detalhe: expect.stringMatching(/flash \(padrão, json\): 400 INVALID_ARGUMENT Request contains an invalid argument/),
    });
  });

  it('chave inválida para na hora (outro modelo não resolve)', async () => {
    const f = vi.fn().mockResolvedValue(erro(400, 'API key not valid. Please pass a valid API key.'));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).rejects.toMatchObject({ codigo: 'chave_invalida' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('formas de pedir', () => {
  it('mensagem genérica: esgota o raciocínio e recomeça no formato seguinte', () => {
    expect(proximaForma({ pensar: 3, formato: 0 }, 'invalid argument')).toEqual({ pensar: 0, formato: 1 });
    expect(proximaForma({ pensar: 3, formato: 2 }, 'invalid argument')).toBeNull();
  });

  it('converte o schema do Gemini em JSON Schema', () => {
    expect(
      paraJsonSchema({
        type: 'OBJECT',
        properties: { c: { type: 'STRING', nullable: true, enum: ['a', 'b'] }, k: { type: 'INTEGER', description: 'km' } },
        required: ['c', 'k'],
      }),
    ).toEqual({
      type: 'object',
      properties: { c: { type: ['string', 'null'], enum: ['a', 'b', null] }, k: { type: 'integer', description: 'km' } },
      required: ['c', 'k'],
    });
  });
});
