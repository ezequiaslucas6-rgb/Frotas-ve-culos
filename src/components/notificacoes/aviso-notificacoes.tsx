'use client';

import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotificacoes } from './use-notificacoes';

const CHAVE = 'rodar:aviso-notificacoes';
const ESCONDER_MS = 3 * 24 * 60 * 60 * 1000;

/** Convite para ativar as notificações neste navegador (só aparece onde falta ativar e é possível). */
export function AvisoNotificacoes() {
  const { estado, ativar } = useNotificacoes();
  // dispensado há pouco? (só no navegador; no servidor este componente não mostra nada)
  const [escondido, setEscondido] = useState(() => {
    try {
      return Date.now() < Number(localStorage.getItem(CHAVE) ?? 0);
    } catch {
      return false;
    }
  });
  const [ocupado, setOcupado] = useState(false);

  if (estado !== 'pedir' || escondido) return null;

  const agoraNao = () => {
    try {
      localStorage.setItem(CHAVE, String(Date.now() + ESCONDER_MS));
    } catch {
      /* sem armazenamento: só some desta vez */
    }
    setEscondido(true);
  };

  return (
    <div role="region" aria-label="Notificações" className="mb-4 flex items-start gap-3 rounded-2xl bg-primary/10 px-4 py-3 text-sm">
      <Bell className="mt-0.5 size-5 shrink-0 text-icone" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Receba os avisos do checklist na hora</p>
        <p className="text-muted-foreground">Ative as notificações neste computador: o aviso chega às 08:00 e às 08:30 (horário de Pimenta Bueno), mesmo com o site fechado.</p>
        <Button
          type="button"
          size="sm"
          className="mt-2"
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true);
            await ativar();
            setOcupado(false);
          }}
        >
          Ativar notificações
        </Button>
      </div>
      <button type="button" onClick={agoraNao} aria-label="Agora não" className="rounded-lg p-1 text-muted-foreground hover:bg-raised">
        <X className="size-4" />
      </button>
    </div>
  );
}
