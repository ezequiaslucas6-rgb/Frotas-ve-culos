/** Push no navegador (lado do cliente): suporte, assinatura e registro no servidor. */

/** O app Android (WebView) se identifica no user agent; lá o push é nativo (Firebase), não o do navegador. */
export const ehApk = () => typeof navigator !== 'undefined' && /FrotasApp\//.test(navigator.userAgent);

export const suportaPushWeb = () =>
  typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Chave pública VAPID (base64url) -> bytes, no formato que o navegador pede. */
export function chaveParaBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const preenchida = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=').replace(/-/g, '+').replace(/_/g, '/');
  const texto = atob(preenchida);
  const bytes = new Uint8Array(new ArrayBuffer(texto.length));
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
  return bytes;
}

export async function pedirChave(): Promise<{ chave: string | null; fcm: boolean }> {
  const r = await fetch('/api/push/chave', { cache: 'no-store' });
  if (!r.ok) return { chave: null, fcm: false };
  return (await r.json()) as { chave: string | null; fcm: boolean };
}

/** Assinatura de push deste navegador (cria se ainda não houver). Precisa da permissão já concedida. */
export async function assinar(chave: string): Promise<PushSubscription> {
  const registro = await navigator.serviceWorker.ready;
  return (
    (await registro.pushManager.getSubscription()) ??
    (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chave) }))
  );
}

/** Registra a assinatura para o usuário logado (idempotente: também passa o aparelho para quem entrou agora). */
export async function registrar(assinatura: PushSubscription): Promise<boolean> {
  const r = await fetch('/api/push/web', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(assinatura.toJSON()),
  });
  return r.ok;
}

export async function cancelar(): Promise<void> {
  const registro = await navigator.serviceWorker.ready;
  const assinatura = await registro.pushManager.getSubscription();
  if (!assinatura) return;
  await fetch('/api/push/web', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: assinatura.endpoint }),
  }).catch(() => undefined);
  await assinatura.unsubscribe();
}
