import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enviarWebPush = vi.fn();
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => enviarWebPush(...a) } }));

import { enviarFcm, enviarParaAlvos, enviarWeb, fcmConfigurado, type Alvo } from './enviar';

const N = { id: 'diario-V1', titulo: 'Bom dia! Hora do checklist', texto: 'Faça o checklist.', url: '/checklists/novo?veiculo=V1&tipo=diario' };
const web: Alvo = { id: 'D1', tipo: 'web', destino: 'https://push.example/abc'.padEnd(40, 'x'), chave_p256dh: 'p'.repeat(30), chave_auth: 'a'.repeat(12) };
const fcm: Alvo = { id: 'D2', tipo: 'fcm', destino: 'token-fcm-'.padEnd(60, 'y'), chave_p256dh: null, chave_auth: null };

describe('Web Push (PC e navegadores)', () => {
  beforeEach(() => {
    enviarWebPush.mockReset();
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('envia o texto da notificação com urgência alta e validade de 30 min', async () => {
    enviarWebPush.mockResolvedValue({ statusCode: 201 });
    expect(await enviarWeb(web, N)).toBe('ok');
    const [assinatura, carga, opcoes] = enviarWebPush.mock.calls[0]!;
    expect(assinatura).toEqual({ endpoint: web.destino, keys: { p256dh: web.chave_p256dh, auth: web.chave_auth } });
    expect(JSON.parse(carga as string)).toEqual({ id: N.id, titulo: N.titulo, texto: N.texto, url: N.url });
    expect(opcoes).toMatchObject({ TTL: 1800, urgency: 'high', vapidDetails: { publicKey: 'pub', privateKey: 'priv' } });
  });

  it('assinatura cancelada (404/410) é inválida; outro erro é falha', async () => {
    enviarWebPush.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    expect(await enviarWeb(web, N)).toBe('invalido');
    enviarWebPush.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    expect(await enviarWeb(web, N)).toBe('erro');
  });

  it('sem as chaves VAPID no servidor, não tenta', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    expect(await enviarWeb(web, N)).toBe('erro');
    expect(enviarWebPush).not.toHaveBeenCalled();
  });
});

describe('FCM (APK)', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const conta = Buffer.from(JSON.stringify({ project_id: 'frotas-123', client_email: 'fcm@frotas-123.iam.gserviceaccount.com', private_key: privateKey })).toString('base64');

  beforeEach(() => vi.stubEnv('FCM_CONTA_SERVICO_BASE64', conta));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('só está configurado com a conta de serviço válida', () => {
    expect(fcmConfigurado()).toBe(true);
    vi.stubEnv('FCM_CONTA_SERVICO_BASE64', '');
    expect(fcmConfigurado()).toBe(false);
    vi.stubEnv('FCM_CONTA_SERVICO_BASE64', Buffer.from('{"project_id":"x"}').toString('base64'));
    expect(fcmConfigurado()).toBe(false);
  });

  it('assina o JWT, troca por token e envia mensagem de dados com prioridade alta', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await enviarFcm(fcm, N)).toBe('ok');

    const [urlToken, initToken] = f.mock.calls[0]!;
    expect(urlToken).toBe('https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(String((initToken as RequestInit).body)).get('assertion')!;
    const [cab, corpo] = assertion.split('.').slice(0, 2).map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    expect(cab).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(corpo).toMatchObject({ iss: 'fcm@frotas-123.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging' });

    const [urlEnvio, initEnvio] = f.mock.calls[1]!;
    expect(urlEnvio).toBe('https://fcm.googleapis.com/v1/projects/frotas-123/messages:send');
    expect((initEnvio as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok' });
    expect(JSON.parse((initEnvio as RequestInit).body as string)).toEqual({
      message: { token: fcm.destino, data: { id: N.id, titulo: N.titulo, texto: N.texto, url: N.url }, android: { priority: 'HIGH', ttl: '1800s' } },
    });
  });

  it('token desinstalado (UNREGISTERED) é inválido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 })));
    expect(await enviarFcm(fcm, N)).toBe('invalido');
  });
});

describe('envio a vários aparelhos', () => {
  it('remove os inválidos, marca os entregues e conta as falhas', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
    enviarWebPush.mockReset();
    enviarWebPush.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    const chamadas: Array<[string, string, unknown]> = [];
    const banco = {
      from: (tabela: string) => ({
        delete: () => ({ in: (_c: string, ids: unknown) => (chamadas.push([tabela, 'delete', ids]), Promise.resolve({})) }),
        update: () => ({ in: (_c: string, ids: unknown) => (chamadas.push([tabela, 'update', ids]), Promise.resolve({})) }),
      }),
    };
    // web: inválido; fcm sem conta de serviço: falha
    vi.stubEnv('FCM_CONTA_SERVICO_BASE64', '');
    const r = await enviarParaAlvos(banco as never, [web, fcm], N);
    expect(r).toEqual({ enviados: 0, removidos: 1, falhas: 1 });
    expect(chamadas).toEqual([['push_dispositivos', 'delete', ['D1']]]);
    vi.unstubAllEnvs();
  });
});
