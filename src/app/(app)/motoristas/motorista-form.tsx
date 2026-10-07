'use client';

import Link from 'next/link';
import { useState } from 'react';
import { salvarMotorista } from '@/actions/motoristas';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { FileUpload } from '@/components/ui/file-upload';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import { useServerForm } from '@/hooks/use-server-form';
import { UFS } from '@/lib/format';
import { CNH_CATEGORIAS } from '@/lib/motoristas/cnh';
import { uuid } from '@/lib/uuid';
import type { Tables } from '@/types/database';

interface MotoristaFormProps {
  /** Admin escolhe a filial no cadastro; supervisor tem a filial fixa (a Server Action ignora o valor do cliente). */
  filiais: Array<{ id: string; nome_cidade: string; uf: string }> | null;
  filialFixaId: string | null;
  motorista?: Tables<'motoristas'>;
  cnhFrenteUrl?: string | null;
  cnhVersoUrl?: string | null;
  /** CPF, WhatsApp e CNH obrigatórios (desligado na fase de testes: lib/motoristas/obrigatorios) */
  obrigatorios: boolean;
}

export function MotoristaForm({ filiais, filialFixaId, motorista, cnhFrenteUrl, cnhVersoUrl, obrigatorios }: MotoristaFormProps) {
  const { state, pending, onSubmit, fieldError } = useServerForm(salvarMotorista);
  const editing = Boolean(motorista);
  const [filialId, setFilialId] = useState<string>(motorista?.filial_id ?? filialFixaId ?? '');
  // pasta estável das imagens da CNH (id real na edição; provisório no cadastro)
  const [pastaId] = useState(() => motorista?.id ?? uuid());
  const pasta = filialId ? `${filialId}/${pastaId}` : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {motorista ? <input type="hidden" name="id" value={motorista.id} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Dados pessoais</CardTitle>
          {obrigatorios ? null : (
            <CardDescription>Fase de testes: só nome e e-mail são obrigatórios. CPF, WhatsApp e CNH podem ficar em branco ou ser fictícios.</CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filiais && !editing ? (
            <Field label="Filial" htmlFor="filial_id" required error={fieldError('filial_id')} className="sm:col-span-2">
              <Select id="filial_id" name="filial_id" required value={filialId} onChange={(e) => setFilialId(e.target.value)}>
                <option value="" disabled>
                  Selecione a filial…
                </option>
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome_cidade}/{f.uf}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Nome completo" htmlFor="nome" required error={fieldError('nome')} className="sm:col-span-2">
            <Input id="nome" name="nome" defaultValue={motorista?.nome} autoComplete="name" required aria-invalid={!!fieldError('nome')} />
          </Field>
          <Field label="CPF" htmlFor="cpf" required={obrigatorios} error={fieldError('cpf')}>
            <MaskedInput id="cpf" name="cpf" mask="cpf" defaultValue={motorista?.cpf ?? undefined} required={obrigatorios} aria-invalid={!!fieldError('cpf')} />
          </Field>
          <Field label="Status" htmlFor="status" error={fieldError('status')}>
            <Select id="status" name="status" defaultValue={motorista?.status ?? 'ativo'}>
              <option value="ativo">Ativo</option>
              <option value="ferias">Férias</option>
              <option value="afastado">Afastado</option>
              <option value="inativo">Inativo (bloqueia o acesso ao app)</option>
            </Select>
          </Field>
          <Field
            label="E-mail"
            htmlFor="email"
            required
            error={fieldError('email')}
            hint={motorista?.user_id ? 'Também é o login do motorista no app.' : undefined}
          >
            <Input id="email" name="email" type="email" inputMode="email" defaultValue={motorista?.email} required aria-invalid={!!fieldError('email')} />
          </Field>
          <Field label="WhatsApp" htmlFor="whatsapp" required={obrigatorios} error={fieldError('whatsapp')} hint="Com DDD">
            <MaskedInput
              id="whatsapp"
              name="whatsapp"
              mask="whatsapp"
              defaultValue={motorista?.whatsapp ?? undefined}
              required={obrigatorios}
              aria-invalid={!!fieldError('whatsapp')}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CNH</CardTitle>
          <CardDescription>Dados do documento e fotos de frente e verso (ou o PDF da CNH digital).</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nº de registro" htmlFor="cnh" required={obrigatorios} error={fieldError('cnh')} hint="11 dígitos">
            <MaskedInput id="cnh" name="cnh" mask="cnh" defaultValue={motorista?.cnh ?? undefined} required={obrigatorios} aria-invalid={!!fieldError('cnh')} />
          </Field>
          <Field label="Categoria" htmlFor="cnh_categoria" required={obrigatorios} error={fieldError('cnh_categoria')}>
            <Select id="cnh_categoria" name="cnh_categoria" defaultValue={motorista?.cnh_categoria ?? ''} aria-invalid={!!fieldError('cnh_categoria')}>
              <option value="" disabled={obrigatorios}>
                {obrigatorios ? 'Selecione…' : 'Não informada'}
              </option>
              {CNH_CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Validade" htmlFor="cnh_validade" required={obrigatorios} error={fieldError('cnh_validade')}>
            <Input id="cnh_validade" name="cnh_validade" type="date" defaultValue={motorista?.cnh_validade ?? ''} aria-invalid={!!fieldError('cnh_validade')} />
          </Field>
          <Field label="Data de emissão" htmlFor="cnh_emissao" error={fieldError('cnh_emissao')}>
            <Input id="cnh_emissao" name="cnh_emissao" type="date" defaultValue={motorista?.cnh_emissao ?? ''} />
          </Field>
          <Field label="1ª habilitação" htmlFor="cnh_primeira_habilitacao" error={fieldError('cnh_primeira_habilitacao')}>
            <Input
              id="cnh_primeira_habilitacao"
              name="cnh_primeira_habilitacao"
              type="date"
              defaultValue={motorista?.cnh_primeira_habilitacao ?? ''}
            />
          </Field>
          <Field label="UF de emissão" htmlFor="cnh_uf" error={fieldError('cnh_uf')}>
            <Select id="cnh_uf" name="cnh_uf" defaultValue={motorista?.cnh_uf ?? ''}>
              <option value="">—</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            name="cnh_ear"
            defaultChecked={motorista?.cnh_ear ?? false}
            label="EAR — Exerce Atividade Remunerada"
            hint="Obrigatório na CNH de quem dirige profissionalmente."
            className="sm:col-span-2"
          />
          <Field label="Observações / restrições" htmlFor="cnh_observacoes" error={fieldError('cnh_observacoes')} className="sm:col-span-2">
            <Textarea
              id="cnh_observacoes"
              name="cnh_observacoes"
              rows={2}
              maxLength={500}
              defaultValue={motorista?.cnh_observacoes ?? ''}
              placeholder="Ex.: uso obrigatório de lentes corretivas"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
            <FileUpload
              name="cnh_frente_path"
              label="CNH — frente (ou PDF da CNH digital)"
              bucket="motoristas"
              pasta={pasta}
              arquivo="cnh-frente"
              maxDimension={2200}
              accept="image/*,application/pdf"
              initialPath={motorista?.cnh_frente_url}
              initialUrl={cnhFrenteUrl}
              hint="Foto nítida, sem reflexo."
            />
            <FileUpload
              name="cnh_verso_path"
              label="CNH — verso"
              bucket="motoristas"
              pasta={pasta}
              arquivo="cnh-verso"
              maxDimension={2200}
              accept="image/*"
              initialPath={motorista?.cnh_verso_url}
              initialUrl={cnhVersoUrl}
              hint="Opcional na CNH digital."
            />
          </div>
        </CardContent>
      </Card>

      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={motorista ? `/motoristas/${motorista.id}` : '/motoristas'} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Cancelar
        </Link>
        <SubmitButton pending={pending} size="lg">
          {editing ? 'Salvar alterações' : 'Cadastrar motorista'}
        </SubmitButton>
      </div>
    </form>
  );
}
