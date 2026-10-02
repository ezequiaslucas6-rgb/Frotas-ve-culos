'use client';

import { salvarPerfil, trocarSenha } from '@/actions/perfil';
import { Field } from '@/components/ui/field';
import { FileUpload } from '@/components/ui/file-upload';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';

export function PerfilForm({
  userId,
  nome,
  nomeEditavel,
  avatarPath,
  avatarUrl,
}: {
  userId: string;
  nome: string;
  nomeEditavel: boolean;
  avatarPath: string | null;
  avatarUrl: string | null;
}) {
  const { state, pending, onSubmit, fieldError } = useServerForm(salvarPerfil);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FileUpload
        name="avatar_path"
        label="Foto de perfil"
        bucket="perfis"
        pasta={userId}
        arquivo="avatar"
        maxDimension={512}
        accept="image/*"
        initialPath={avatarPath}
        initialUrl={avatarUrl}
        hint="Aparece no topo do sistema."
      />
      <Field
        label="Nome de exibição"
        htmlFor="nome"
        required={nomeEditavel}
        error={fieldError('nome')}
        hint={nomeEditavel ? undefined : 'O nome vem do seu cadastro de motorista; para corrigir, fale com o supervisor.'}
      >
        <Input id="nome" name="nome" defaultValue={nome} autoComplete="name" disabled={!nomeEditavel} required={nomeEditavel} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} className="self-end">
        Salvar perfil
      </SubmitButton>
    </form>
  );
}

export function SenhaForm({ email }: { email: string }) {
  const { state, pending, onSubmit, fieldError } = useServerForm(trocarSenha);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {/* ajuda o gerenciador de senhas do navegador a associar a nova senha ao login */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Field label="Senha atual" htmlFor="senha_atual" required error={fieldError('senha_atual')}>
        <Input id="senha_atual" name="senha_atual" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Nova senha" htmlFor="nova_senha" required error={fieldError('nova_senha')} hint="Mínimo de 8 caracteres.">
        <Input id="nova_senha" name="nova_senha" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirme a nova senha" htmlFor="confirmar" required error={fieldError('confirmar')}>
        <Input id="confirmar" name="confirmar" type="password" autoComplete="new-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} className="self-end" pendingText="Alterando…">
        Alterar senha
      </SubmitButton>
    </form>
  );
}
