'use client';

import { startTransition, useActionState, useState } from 'react';
import { KeyRound, Loader2, RefreshCw, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { criarAcessoMotorista, redefinirSenhaMotorista, removerAcessoMotorista } from '@/actions/motoristas';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';
import { idle } from '@/lib/action-state';

/** Senha provisória fácil de ditar (sem 0/O, 1/l/I). */
function gerarSenha() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const sorteio = crypto.getRandomValues(new Uint32Array(10));
  const parte = (alfabeto: string, de: number, ate: number) =>
    Array.from(sorteio.slice(de, ate), (n) => alfabeto[n % alfabeto.length]).join('');
  return `${parte(letras, 0, 4)}-${parte(numeros, 4, 8)}`;
}

function SenhaProvisoria({ id }: { id: string }) {
  const [senha, setSenha] = useState('');
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        name="senha"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        autoComplete="new-password"
        placeholder="mín. 8 caracteres"
        className="font-mono"
        required
        minLength={8}
      />
      <Button type="button" variant="secondary" onClick={() => setSenha(gerarSenha())} title="Gerar senha">
        <RefreshCw /> Gerar
      </Button>
    </div>
  );
}

interface AcessoAppProps {
  motoristaId: string;
  email: string;
  temAcesso: boolean;
  inativo: boolean;
}

export function AcessoApp({ motoristaId, email, temAcesso, inativo }: AcessoAppProps) {
  const criar = useServerForm(criarAcessoMotorista);
  const redefinir = useServerForm(redefinirSenhaMotorista);
  const [remocao, remover, removendo] = useActionState(removerAcessoMotorista, idle);
  const [mostrarRedefinir, setMostrarRedefinir] = useState(false);
  // a página é revalidada ao liberar o acesso e o formulário some: guarda a senha para exibi-la uma última vez
  const [senhaCriada, setSenhaCriada] = useState<string | null>(null);

  if (!temAcesso) {
    return (
      <form
        onSubmit={(e) => {
          setSenhaCriada(String(new FormData(e.currentTarget).get('senha') ?? ''));
          criar.onSubmit(e);
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="motorista_id" value={motoristaId} />
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
          <p>
            Com o acesso, o motorista entra pelo celular com o e-mail <strong className="text-foreground">{email}</strong>, vê o
            veículo sob a responsabilidade dele e lança os abastecimentos.
          </p>
        </div>
        {inativo ? (
          <p className="text-sm text-warning-text">Motorista inativo: reative o cadastro para liberar o acesso.</p>
        ) : (
          <>
            <Field label="Senha provisória" htmlFor="senha-nova" error={criar.fieldError('senha')} hint="Repasse ao motorista; ele pode trocá-la em Meu perfil.">
              <SenhaProvisoria id="senha-nova" />
            </Field>
            <FormMessage state={criar.state} />
            <SubmitButton pending={criar.pending} pendingText="Liberando…">
              <ShieldCheck /> Liberar acesso ao app
            </SubmitButton>
          </>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl bg-success/12 px-3.5 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success-text" />
        <div>
          <p className="font-semibold text-success-text">{inativo ? 'Acesso suspenso (motorista inativo)' : 'Acesso liberado'}</p>
          <p className="text-muted-foreground">
            Login: <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>
      </div>

      {criar.state.status === 'success' && senhaCriada ? (
        <div role="status" className="rounded-xl bg-raised px-3.5 py-3 text-sm">
          <p className="font-medium">{criar.state.message}</p>
          <p className="mt-1 text-muted-foreground">
            Senha provisória: <span className="font-mono font-semibold text-foreground select-all">{senhaCriada}</span> — anote agora, ela
            não aparece de novo.
          </p>
        </div>
      ) : null}

      {mostrarRedefinir ? (
        <form onSubmit={redefinir.onSubmit} className="flex flex-col gap-3">
          <input type="hidden" name="motorista_id" value={motoristaId} />
          <Field label="Nova senha" htmlFor="senha-redefinir" error={redefinir.fieldError('senha')}>
            <SenhaProvisoria id="senha-redefinir" />
          </Field>
          <FormMessage state={redefinir.state} />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMostrarRedefinir(false)}>
              Cancelar
            </Button>
            <SubmitButton pending={redefinir.pending} className="flex-1">
              Redefinir senha
            </SubmitButton>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setMostrarRedefinir(true)}>
            <KeyRound /> Redefinir senha
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={removendo}
            className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
            onClick={() => {
              if (!window.confirm('Remover o acesso deste motorista ao app? O histórico de abastecimentos é mantido.')) return;
              const fd = new FormData();
              fd.set('id', motoristaId);
              startTransition(() => remover(fd));
            }}
          >
            {removendo ? <Loader2 className="animate-spin" /> : <ShieldOff />} Remover acesso
          </Button>
        </div>
      )}
      <FormMessage state={remocao} />
    </div>
  );
}
