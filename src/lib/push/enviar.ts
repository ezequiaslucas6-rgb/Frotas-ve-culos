import 'server-only';
import { createSign } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import type { Notificacao } from '@/lib/checklist/lembretes';
import type { Database } from '@/types/database';

/**
 * Entrega de push pelo servidor. Dois caminhos, sem serviço pago nem biblioteca do Google:
 *  - web: Web Push (VAPID) para navegadores (PC e Android): o serviço de push do próprio
 *    navegador entrega na hora, com a aba fechada;
 *  - fcm: Firebase Cloud Messaging (API v1) para o APK, que acorda o celular na hora.
 */

/** Quanto tempo a notificação ainda vale se o aparelho estiver desligado/sem rede (segundos). */
export const VALIDADE_S = 30 * 60;

export interface Alvo {
  id: string;
  tipo: 'web' | 'fcm';
  destino: string;
  chave_p256dh: string | null;
  chave_auth: string | null;
}

export type Resultado = 'ok' | 'invalido' | 'erro';

/* --------------------------------------------------------------------------------- web */

export const chavePublicaVapid = () => process.env.VAPID_PUBLIC_KEY?.trim() || null;
export const webPushConfigurado = () => Boolean(chavePublicaVapid() && process.env.VAPID_PRIVATE_KEY?.trim());

export async function enviarWeb(alvo: Alvo, n: Notificacao): Promise<Resultado> {
  if (!webPushConfigurado() || !alvo.chave_p256dh || !alvo.chave_auth) return 'erro';
  try {
    await webpush.sendNotification(
      { endpoint: alvo.destino, keys: { p256dh: alvo.chave_p256dh, auth: alvo.chave_auth } },
      JSON.stringify({ id: n.id, titulo: n.titulo, texto: n.texto, url: n.url }),
      {
        TTL: VALIDADE_S,
        urgency: 'high',
        timeout: 15_000,
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@frotas.local',
          publicKey: process.env.VAPID_PUBLIC_KEY!.trim(),
          privateKey: process.env.VAPID_PRIVATE_KEY!.trim(),
        },
      },
    );
    return 'ok';
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    // 404/410: a assinatura foi cancelada ou expirou no navegador
    if (status === 404 || status === 410) return 'invalido';
    console.warn(`[push/web] ${status ?? ''} ${(e as Error).message}`.slice(0, 300));
    return 'erro';
  }
}

/* --------------------------------------------------------------------------------- fcm */

interface ContaServico {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Conta de serviço do Firebase: JSON em base64 na variável FCM_CONTA_SERVICO_BASE64 do .env. */
function contaServico(): ContaServico | null {
  const b64 = process.env.FCM_CONTA_SERVICO_BASE64?.trim();
  if (!b64) return null;
  try {
    const c = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Partial<ContaServico>;
    return c.project_id && c.client_email && c.private_key ? (c as ContaServico) : null;
  } catch {
    return null;
  }
}

export const fcmConfigurado = () => contaServico() != null;

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');
let tokenAcesso: { valor: string; expira: number } | null = null;

/** Token OAuth da conta de serviço (vale 1 h): JWT assinado com a chave privada, trocado no Google. */
async function obterTokenAcesso(conta: ContaServico): Promise<string> {
  if (tokenAcesso && tokenAcesso.expira > Date.now() + 60_000) return tokenAcesso.valor;
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64url(
    JSON.stringify({
      iss: conta.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 3600,
    }),
  );
  const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const assinatura = createSign('RSA-SHA256').update(`${cabecalho}.${corpo}`).sign(conta.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cabecalho}.${corpo}.${b64url(assinatura)}` }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`token FCM: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  tokenAcesso = { valor: j.access_token, expira: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export async function enviarFcm(alvo: Alvo, n: Notificacao): Promise<Resultado> {
  const conta = contaServico();
  if (!conta) return 'erro';
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${conta.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await obterTokenAcesso(conta)}` },
      body: JSON.stringify({
        message: {
          token: alvo.destino,
          // só "data": o app monta a notificação (também com o app fechado ou em primeiro plano)
          data: { id: n.id, titulo: n.titulo, texto: n.texto, url: n.url },
          android: { priority: 'HIGH', ttl: `${VALIDADE_S}s` },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return 'ok';
    const texto = await r.text();
    // 404 UNREGISTERED: app desinstalado ou token trocado; 400 INVALID_ARGUMENT: token malformado
    if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(texto)) return 'invalido';
    if (r.status === 401) tokenAcesso = null;
    console.warn(`[push/fcm] ${r.status} ${texto}`.slice(0, 300));
    return 'erro';
  } catch (e) {
    console.warn(`[push/fcm] ${(e as Error).message}`.slice(0, 300));
    return 'erro';
  }
}

/* ----------------------------------------------------------------------------- conjunto */

export interface ResumoEnvio {
  enviados: number;
  removidos: number;
  falhas: number;
}

/** Envia `n` a todos os aparelhos; remove os que não existem mais e marca o horário do último envio. */
export async function enviarParaAlvos(supabase: SupabaseClient<Database>, alvos: readonly Alvo[], n: Notificacao): Promise<ResumoEnvio> {
  const resultados = await Promise.all(alvos.map(async (a) => [a, a.tipo === 'web' ? await enviarWeb(a, n) : await enviarFcm(a, n)] as const));
  const ok = resultados.filter(([, r]) => r === 'ok').map(([a]) => a.id);
  const invalidos = resultados.filter(([, r]) => r === 'invalido').map(([a]) => a.id);
  if (invalidos.length) await supabase.from('push_dispositivos').delete().in('id', invalidos);
  if (ok.length) await supabase.from('push_dispositivos').update({ ultimo_envio_em: new Date().toISOString() }).in('id', ok);
  return { enviados: ok.length, removidos: invalidos.length, falhas: resultados.length - ok.length - invalidos.length };
}
