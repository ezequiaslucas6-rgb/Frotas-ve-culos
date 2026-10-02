'use client';

import { useTransition } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { atualizarAlertas } from '@/actions/alertas';
import { Button } from '@/components/ui/button';

export function AtualizarAlertasButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await atualizarAlertas();
          if (result.status === 'success') toast.success(result.message);
          else if (result.status === 'error') toast.error(result.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      Atualizar alertas
    </Button>
  );
}
