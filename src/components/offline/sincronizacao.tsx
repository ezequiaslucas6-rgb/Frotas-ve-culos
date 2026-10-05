'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { salvarChecklist } from '@/actions/checklists';
import {
  EVENTO_FILA,
  apagarEnvio,
  apagarFotosDoChecklist,
  listarEnvios,
  processarEnvio,
  subirFoto,
  todasAsFotos,
  type EnvioPendente,
} from '@/lib/offline/fila';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

const INTERVALO_MS = 30_000;
/** fotos de checklists abandonados (sem envio na fila) somem do aparelho depois disso */
const VALIDADE_FOTO_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Envia sozinho os checklists guardados no aparelho sem internet: ao abrir o app, quando a
 * conexão volta e a cada 30 s enquanto houver pendências. Mostra um aviso discreto com o
 * que está na fila. Também deixa a tela do checklist guardada para abrir sem sinal.
 */
export function SincronizacaoOffline({ userId, oculto = false }: { userId: string; oculto?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [envios, setEnvios] = useState<EnvioPendente[]>([]);
  const [enviando, setEnviando] = useState(false);
  const rodando = useRef(false);

  const atualizar = useCallback(async () => setEnvios(await listarEnvios(userId)), [userId]);

  const sincronizar = useCallback(async () => {
    if (rodando.current || !navigator.onLine) return;
    rodando.current = true;
    setEnviando(true);
    try {
      const fila = await listarEnvios(userId);
      const naFila = new Set(fila.map((e) => e.checklistId));
      // fotos de checklists ainda em andamento sobem logo; as abandonadas são apagadas
      for (const foto of await todasAsFotos()) {
        if (foto.userId !== userId) continue;
        if (!naFila.has(foto.checklistId) && Date.now() - foto.criadaEm > VALIDADE_FOTO_MS) {
          await apagarFotosDoChecklist(foto.checklistId);
          continue;
        }
        if (!foto.enviada && (await subirFoto(supabase, foto)) === 'rede') break;
      }
      for (const envio of fila) {
        if (envio.erro) continue;
        const r = await processarEnvio(envio, supabase, salvarChecklist);
        if (r.estado === 'enviado') {
          toast.success(`Checklist ${envio.placa} enviado.`);
          router.refresh();
        } else if (r.estado === 'recusado') {
          toast.error(`Checklist ${envio.placa} não foi aceito: ${r.mensagem}`);
        } else {
          break; // sem conexão de novo: tenta mais tarde
        }
      }
    } finally {
      rodando.current = false;
      setEnviando(false);
      await atualizar();
    }
  }, [atualizar, router, supabase, userId]);

  useEffect(() => {
    // ao abrir o app (fora do ciclo do efeito: a leitura do IndexedDB é assíncrona)
    const inicio = setTimeout(() => void atualizar().then(sincronizar), 0);
    const aoVoltar = () => void sincronizar();
    const aoMudar = () => void atualizar();
    window.addEventListener('online', aoVoltar);
    window.addEventListener(EVENTO_FILA, aoMudar);
    return () => {
      clearTimeout(inicio);
      window.removeEventListener('online', aoVoltar);
      window.removeEventListener(EVENTO_FILA, aoMudar);
    };
  }, [atualizar, sincronizar]);

  // enquanto houver checklist esperando, tenta de tempos em tempos (a rede pode voltar sem o evento "online")
  const pendentes = envios.filter((e) => !e.erro).length;
  useEffect(() => {
    if (!pendentes) return;
    const timer = setInterval(() => void sincronizar(), INTERVALO_MS);
    return () => clearInterval(timer);
  }, [pendentes, sincronizar]);

  // guarda a tela do checklist no aparelho (service worker) para abrir sem internet
  // (uma vez por sessão e por usuário: quem entra depois de outro na mesma aba guarda a sua)
  useEffect(() => {
    const chave = `rodar:pre-carregado:${userId}`;
    try {
      if (sessionStorage.getItem(chave) || !navigator.onLine) return;
      navigator.serviceWorker?.ready
        .then((reg) => {
          reg.active?.postMessage({ tipo: 'pre-carregar', urls: ['/checklists/novo'] });
          sessionStorage.setItem(chave, '1');
        })
        .catch(() => undefined);
    } catch {
      /* sem service worker: o checklist só abre com internet */
    }
  }, [userId]);

  if (oculto || envios.length === 0) return null;
  const recusado = envios.find((e) => e.erro);

  return (
    <div
      role="status"
      className={cn(
        'fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm shadow-[0_8px_30px_rgb(0_0_0/0.25)] md:inset-x-auto md:right-6 md:bottom-6',
        recusado && 'border-destructive/40',
      )}
    >
      {recusado ? (
        <>
          <CloudOff className="size-5 shrink-0 text-destructive-text" />
          <p className="min-w-0 flex-1">
            <strong className="block">Checklist {recusado.placa} não enviado</strong>
            <span className="text-xs text-muted-foreground">{recusado.erro}</span>
          </p>
          <button
            type="button"
            onClick={() => void apagarEnvio(recusado.checklistId)}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-destructive-text hover:bg-destructive/10"
          >
            <Trash2 className="size-4" /> Descartar
          </button>
        </>
      ) : (
        <>
          {enviando ? <Loader2 className="size-5 shrink-0 animate-spin text-icone" /> : <CloudOff className="size-5 shrink-0 text-icone" />}
          <p className="min-w-0 flex-1">
            <strong className="block">
              {enviando ? 'Enviando' : pendentes === 1 ? '1 checklist' : `${pendentes} checklists`}
              {enviando ? ' checklist guardado…' : ' aguardando internet'}
            </strong>
            <span className="text-xs text-muted-foreground">Guardado neste aparelho; o envio é automático.</span>
          </p>
          {!enviando ? (
            <button
              type="button"
              onClick={() => void sincronizar()}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              <UploadCloud className="size-4" /> Enviar agora
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
