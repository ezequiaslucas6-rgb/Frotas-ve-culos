'use client';

import { useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useNotificacoes } from './use-notificacoes';

const TEXTO = {
  carregando: 'Verificando…',
  apk: 'Os avisos chegam pelo app, na hora certa. Toque em “Enviar teste” para conferir neste celular.',
  indisponivel: 'Este navegador não recebe notificações. No Chrome ou no Edge, pelo endereço https do sistema, elas funcionam.',
  'nao-configurado': 'O servidor ainda não está configurado para enviar notificações. Avise o administrador.',
  pedir: 'Desativadas neste navegador.',
  negado: 'Bloqueadas neste navegador. Toque no cadeado ao lado do endereço do site, permita as notificações e recarregue a página.',
  ativo: 'Ativadas neste navegador: o aviso chega na hora, mesmo com o site fechado.',
} as const;

/** Em Perfil: situação das notificações, ativar/desativar e enviar um teste. */
export function CartaoNotificacoes({ papel }: { papel: 'motorista' | 'supervisor' | 'admin' }) {
  const { estado, ativar, desativar } = useNotificacoes();
  const [teste, setTeste] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviarTeste() {
    setOcupado(true);
    setTeste(null);
    try {
      const r = await fetch('/api/push/teste', { method: 'POST' });
      const j = (await r.json()) as { ok: boolean; motivo?: string };
      setTeste(j.ok ? 'Teste enviado: a notificação deve aparecer em instantes.' : j.motivo ? 'Nenhum aparelho cadastrado ainda. Ative as notificações primeiro.' : 'Não foi possível entregar o teste. Tente de novo.');
    } catch {
      setTeste('Sem conexão com o servidor.');
    }
    setOcupado(false);
  }

  const Icone = estado === 'ativo' || estado === 'apk' ? BellRing : estado === 'negado' || estado === 'indisponivel' ? BellOff : Bell;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icone className="size-5 text-icone" /> Notificações
        </CardTitle>
        <CardDescription>
          {papel === 'motorista' ? 'Lembrete do checklist às 08:00' : 'Resumo do checklist de hoje às 08:30'}, no horário de Pimenta Bueno.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{TEXTO[estado]}</p>
        <div className="flex flex-wrap gap-2">
          {estado === 'pedir' ? (
            <Button type="button" onClick={() => void ativar()}>
              Ativar notificações
            </Button>
          ) : null}
          {estado === 'ativo' ? (
            <Button type="button" variant="outline" onClick={() => void desativar()}>
              Desativar neste navegador
            </Button>
          ) : null}
          {estado === 'ativo' || estado === 'apk' ? (
            <Button type="button" variant="secondary" disabled={ocupado} onClick={() => void enviarTeste()}>
              Enviar teste
            </Button>
          ) : null}
        </div>
        {teste ? (
          <p role="status" className="text-sm">
            {teste}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
