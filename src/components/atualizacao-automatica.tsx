'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/** Versão deste app (embutida no build; ver next.config.ts). */
export const VERSAO_APP = process.env.NEXT_PUBLIC_VERSAO_APP ?? 'dev';

const INTERVALO_MS = 10 * 60_000;
/** não confere mais de uma vez por minuto (foco e visibilidade disparam juntos) */
const INTERVALO_MINIMO_MS = 60_000;
/** telas com formulário: recarregar perderia o que foi digitado — só avisa */
export const ROTA_DE_FORMULARIO = /\/(novo|nova|editar|concluir|modelos|testar-leitura)(\/|$)|^\/perfil(\/|$)/;
const CHAVE_RECARGA = 'rodar:recarregado-para';

/**
 * Atualização automática do app (APK, atalho na tela inicial ou navegador). Ao voltar para o
 * app, ao recuperar a internet e a cada 10 minutos, confere a versão publicada no servidor.
 * Se mudou: recarrega sozinho; numa tela de formulário, mostra um aviso e recarrega ao sair dela.
 */
export function AtualizacaoAutomatica() {
  const pathname = usePathname();
  const [nova, setNova] = useState<string | null>(null);
  const ultima = useRef(0);

  const verificar = useCallback(async (forcar = false) => {
    if (VERSAO_APP === 'dev' || !navigator.onLine) return;
    if (!forcar && Date.now() - ultima.current < INTERVALO_MINIMO_MS) return;
    ultima.current = Date.now();
    try {
      const r = await fetch('/api/versao', { cache: 'no-store' });
      const { versao } = (await r.json()) as { versao?: string };
      if (versao && versao !== 'dev' && versao !== VERSAO_APP) setNova(versao);
    } catch {
      /* sem conexão: confere na próxima */
    }
  }, []);

  // versão na página (suporte: document.documentElement.dataset.versao)
  useEffect(() => {
    document.documentElement.dataset.versao = VERSAO_APP;
  }, []);

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void verificar();
    };
    // o APK avisa quando o app volta do segundo plano (o WebView nem sempre dispara os eventos acima)
    const aoRetomar = () => void verificar(true);
    const inicio = setTimeout(() => void verificar(true), 5_000);
    const periodico = setInterval(() => void verificar(), INTERVALO_MS);
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('online', aoVoltar);
    window.addEventListener('rodar:retomar', aoRetomar);
    return () => {
      clearTimeout(inicio);
      clearInterval(periodico);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('online', aoVoltar);
      window.removeEventListener('rodar:retomar', aoRetomar);
    };
  }, [verificar]);

  // fora de formulário, recarrega já com a versão nova
  useEffect(() => {
    if (!nova || ROTA_DE_FORMULARIO.test(pathname)) return;
    try {
      // se já recarregou para esta versão e o servidor continua mandando a antiga, só avisa (sem laço)
      if (sessionStorage.getItem(CHAVE_RECARGA) === nova) return;
      sessionStorage.setItem(CHAVE_RECARGA, nova);
    } catch {
      /* sem sessionStorage: recarrega uma vez assim mesmo */
    }
    window.location.reload();
  }, [nova, pathname]);

  if (!nova) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[60] flex justify-center">
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-lg">
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Nova versão do Rodar.</span>{' '}
          {ROTA_DE_FORMULARIO.test(pathname) ? 'Termine este formulário; ela entra ao sair dele.' : 'Toque para atualizar.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/20 px-3 py-1.5 font-semibold hover:bg-white/30 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        >
          <RefreshCw className="size-4" /> Atualizar
        </button>
      </div>
    </div>
  );
}
