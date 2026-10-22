'use client';

import { useCallback, useEffect, useState } from 'react';
import { assinar, cancelar, ehApk, pedirChave, registrar, suportaPushWeb } from '@/lib/push/cliente';

/**
 *  carregando     verificando
 *  apk            app Android: o aviso é nativo (Firebase), nada a fazer no navegador
 *  indisponivel   este navegador não recebe push (ou o site não está em https)
 *  nao-configurado o servidor ainda não tem as chaves de push
 *  pedir          falta a pessoa permitir
 *  negado         a pessoa bloqueou nas configurações do navegador
 *  ativo          recebendo
 */
export type EstadoNotificacoes = 'carregando' | 'apk' | 'indisponivel' | 'nao-configurado' | 'pedir' | 'negado' | 'ativo';

export function useNotificacoes() {
  const [estado, setEstado] = useState<EstadoNotificacoes>('carregando');
  const [chave, setChave] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (ehApk()) return setEstado('apk');
      if (!suportaPushWeb()) return setEstado('indisponivel');
      const { chave: c } = await pedirChave().catch(() => ({ chave: null }));
      if (cancelado) return;
      if (!c) return setEstado('nao-configurado');
      setChave(c);
      if (Notification.permission === 'denied') return setEstado('negado');
      if (Notification.permission === 'default') return setEstado('pedir');
      // já permitido: confirma a assinatura no servidor a cada abertura (também troca o dono se outra pessoa entrou neste PC)
      try {
        const ok = await registrar(await assinar(c));
        if (!cancelado) setEstado(ok ? 'ativo' : 'pedir');
      } catch {
        if (!cancelado) setEstado('pedir');
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const ativar = useCallback(async () => {
    if (!chave) return false;
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      setEstado(permissao === 'denied' ? 'negado' : 'pedir');
      return false;
    }
    try {
      const ok = await registrar(await assinar(chave));
      setEstado(ok ? 'ativo' : 'pedir');
      return ok;
    } catch {
      setEstado('pedir');
      return false;
    }
  }, [chave]);

  const desativar = useCallback(async () => {
    await cancelar();
    setEstado(Notification.permission === 'denied' ? 'negado' : 'pedir');
  }, []);

  return { estado, ativar, desativar };
}
