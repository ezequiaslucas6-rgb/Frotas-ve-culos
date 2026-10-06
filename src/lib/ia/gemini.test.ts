import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esquecerFormasAceitas, FORMAS_DE_CHAMADA, gerarJsonDeImagem } from './gemini';

const ok = (json: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: 'STOP' }] }), { status: 200 });
const erro = (status: number, message: string) => new Response(JSON.stringify({ error: { code: status, message, status: 'INVALID_ARGUMENT' } }), { status });
const chamar = () => gerarJsonDeImagem({ imagemBase64: 'AAAA', mimeType: 'image/jpeg', instrucoes: 'leia', schema: {} });

/** o que foi pedido em cada chamada: modelo e os ajustes do generationConfig */
const pedidos = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map(([url, init]) => {
    const config = { ...JSON.parse((init as RequestInit).body as string).generationConfig };
    delete config.responseMimeType;
    delete config.responseSchema;
    return { modelo: decodeURIComponent(String(url).split('/models/')[1]!.split(':')[0]!), ajustes: config };
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

  it('pede sem "raciocínio" e devolve o JSON', async () => {
    const f = vi.fn().mockResolvedValue(ok({ litros: 40.35 }));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).resolves.toMatchObject({ modelo: 'flash', json: { litros: 40.35 } });
    expect(pedidos(f)).toEqual([{ modelo: 'flash', ajustes: FORMAS_DE_CHAMADA[0] }]);
  });

  it('modelo que recusa o ajuste (400, qualquer mensagem) é chamado de novo de outra forma, até a simples', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(erro(400, 'Media resolution is not supported for this model.'))
      .mockResolvedValueOnce(erro(400, 'Thinking level is not supported for this model.'))
      .mockResolvedValueOnce(ok({ litros: 1 }));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).resolves.toMatchObject({ modelo: 'flash' });
    expect(pedidos(f).map((p) => p.ajustes)).toEqual([FORMAS_DE_CHAMADA[0], FORMAS_DE_CHAMADA[1], {}]);
    // a próxima leitura já vai direto na forma aceita
    f.mockResolvedValueOnce(ok({ litros: 2 }));
    await chamar();
    expect(pedidos(f).at(-1)).toEqual({ modelo: 'flash', ajustes: {} });
  });

  it('limite no primeiro modelo: usa o próximo', async () => {
    const f = vi.fn().mockResolvedValueOnce(erro(429, 'quota')).mockResolvedValueOnce(ok({ litros: 3 }));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).resolves.toMatchObject({ modelo: 'lite' });
  });

  it('recusado em todas as formas e modelos: erro "recusado" com o motivo do Google', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => erro(400, 'Request contains an invalid argument.')));
    await expect(chamar()).rejects.toMatchObject({ codigo: 'recusado', detalhe: expect.stringMatching(/flash \(forma 3\): 400 INVALID_ARGUMENT Request contains an invalid argument/) });
  });

  it('chave inválida para na hora (outro modelo não resolve)', async () => {
    const f = vi.fn().mockResolvedValue(erro(400, 'API key not valid. Please pass a valid API key.'));
    vi.stubGlobal('fetch', f);
    await expect(chamar()).rejects.toMatchObject({ codigo: 'chave_invalida' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
