'use client';

import { useEffect } from 'react';
import { VERSAO_APP } from '@/components/atualizacao-automatica';

/**
 * Registra o service worker (public/sw.js) que deixa o checklist abrir sem internet.
 * `limpar`: na tela de login, apaga a tela guardada (era de quem saiu da conta). A fila de
 * checklists guardados continua: nada que ainda não foi enviado é perdido.
 */
export function RegistrarServiceWorker({ limpar = false }: { limpar?: boolean }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    // uma versão do service worker por publicação (os caches da versão anterior são apagados);
    // updateViaCache 'none': o arquivo do service worker nunca vem do cache do navegador
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(VERSAO_APP)}`, { updateViaCache: 'none' })
      .then(() => (limpar ? navigator.serviceWorker.ready : null))
      // só se ainda estiver no login: depois de entrar, a tela já é guardada de novo para quem entrou
      .then((reg) => {
        if (location.pathname.startsWith('/login')) reg?.active?.postMessage({ tipo: 'limpar-paginas' });
      })
      .catch(() => undefined);
  }, [limpar]);
  return null;
}
