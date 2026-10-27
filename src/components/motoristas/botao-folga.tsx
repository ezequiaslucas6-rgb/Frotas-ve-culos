'use client';

import { useState, useTransition } from 'react';
import { CalendarOff, CalendarPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { alternarFolgaDaSemana } from '@/actions/motoristas';
import { Button } from '@/components/ui/button';

/**
 * "Folga da semana": um toque liga e outro desliga a folga do motorista na sexta, no sábado e no
 * domingo desta semana. Acaba sozinha no domingo (na segunda ele volta, sem desmarcar).
 * `periodo` = os dias exatos ("sex 24/10 a dom 26/10"), sempre à vista.
 */
export function BotaoFolga({
  motoristaId,
  ativaInicial,
  periodo,
  size = 'default',
}: {
  motoristaId: string;
  ativaInicial: boolean;
  periodo: string;
  size?: 'default' | 'sm';
}) {
  const [ativa, setAtiva] = useState(ativaInicial);
  const [pendente, iniciar] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={ativa ? 'bg-warning/20 text-warning-text ring-1 ring-warning/50 hover:bg-warning/30' : undefined}
      disabled={pendente}
      aria-pressed={ativa}
      title={ativa ? `De folga: ${periodo}. Toque para cancelar.` : `Marcar folga: ${periodo}`}
      onClick={() =>
        iniciar(async () => {
          const r = await alternarFolgaDaSemana(motoristaId);
          if (!r.ok) return void toast.error(r.mensagem ?? 'Não foi possível alterar a folga.');
          setAtiva(Boolean(r.ativa));
          toast.success(r.ativa ? `Folga da semana marcada: ${r.periodo}` : 'Folga da semana cancelada');
        })
      }
    >
      {pendente ? <Loader2 className="animate-spin" /> : ativa ? <CalendarOff /> : <CalendarPlus />}
      <span className="flex flex-col items-start leading-tight">
        <span>Folga da semana</span>
        <span className="text-[11px] font-normal opacity-80">{periodo}</span>
      </span>
    </Button>
  );
}
