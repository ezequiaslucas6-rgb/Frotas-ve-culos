'use client';

import Link from 'next/link';
import { useState } from 'react';
import { salvarVeiculo } from '@/actions/veiculos';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FileUpload } from '@/components/ui/file-upload';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Select } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import { useServerForm } from '@/hooks/use-server-form';
import { uuid } from '@/lib/uuid';
import type { Tables } from '@/types/database';

interface VeiculoFormProps {
  /** Admin escolhe a filial; supervisor tem a filial fixa (a Server Action ignora o valor do cliente). */
  filiais: Array<{ id: string; nome_cidade: string; uf: string }> | null;
  filialFixaId: string | null;
  veiculo?: Tables<'veiculos'>;
  fotoUrl?: string | null;
  documentoUrl?: string | null;
  /** motoristas que podem ser responsáveis (a lista mostra só os da filial escolhida) */
  motoristas: Array<Pick<Tables<'motoristas'>, 'id' | 'nome' | 'filial_id' | 'status' | 'user_id'>>;
}

export function VeiculoForm({ filiais, filialFixaId, veiculo, fotoUrl, documentoUrl, motoristas }: VeiculoFormProps) {
  const { state, pending, onSubmit, fieldError } = useServerForm(salvarVeiculo);
  const editing = Boolean(veiculo);
  const [filialId, setFilialId] = useState<string>(veiculo?.filial_id ?? filialFixaId ?? '');
  // pasta estável do veículo no Storage (id real na edição; id provisório no cadastro)
  const [pastaId] = useState(() => veiculo?.id ?? uuid());

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {veiculo ? <input type="hidden" name="id" value={veiculo.id} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Placa" htmlFor="placa" required error={fieldError('placa')}>
            <MaskedInput id="placa" name="placa" mask="placa" defaultValue={veiculo?.placa} required aria-invalid={!!fieldError('placa')} />
          </Field>
          <Field label="Ano" htmlFor="ano" error={fieldError('ano')}>
            <Input id="ano" name="ano" type="number" inputMode="numeric" min={1950} max={2100} defaultValue={veiculo?.ano ?? ''} />
          </Field>
          <Field label="Marca" htmlFor="marca" error={fieldError('marca')}>
            <Input id="marca" name="marca" defaultValue={veiculo?.marca ?? ''} placeholder="Ex.: Fiat" />
          </Field>
          <Field label="Modelo" htmlFor="modelo" error={fieldError('modelo')}>
            <Input id="modelo" name="modelo" defaultValue={veiculo?.modelo ?? ''} placeholder="Ex.: Strada" />
          </Field>
          <Field
            label="Motorista responsável"
            htmlFor="motorista_id"
            error={fieldError('motorista_id')}
            hint="Com acesso ao app, o motorista vê este veículo e lança os abastecimentos."
            className="sm:col-span-2"
          >
            {/* key: ao trocar a filial, a seleção anterior (de outra filial) é descartada */}
            <Select key={filialId} id="motorista_id" name="motorista_id" defaultValue={veiculo?.motorista_id ?? ''} disabled={!filialId}>
              <option value="">{filialId ? 'Nenhum' : 'Selecione a filial primeiro'}</option>
              {motoristas
                .filter((m) => m.filial_id === filialId && (m.status !== 'inativo' || m.id === veiculo?.motorista_id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                    {m.user_id ? '' : ' (sem acesso ao app)'}
                  </option>
                ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fotos e documento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FileUpload
            name="foto_geral_path"
            label="Foto geral do veículo"
            pasta={filialId ? `${filialId}/veiculos/${pastaId}` : null}
            arquivo="foto-geral"
            accept="image/*"
            capture
            initialPath={veiculo?.foto_geral_url}
            initialUrl={fotoUrl}
            hint="Tire uma foto ou escolha da galeria."
          />
          <FileUpload
            name="documento_path"
            label="Documento do veículo (CRLV)"
            pasta={filialId ? `${filialId}/veiculos/${pastaId}` : null}
            arquivo="documento"
            maxDimension={2200}
            accept="image/*,application/pdf"
            initialPath={veiculo?.documento_url}
            initialUrl={documentoUrl}
            hint="PDF ou imagem digitalizada (até 10 MB)."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quilometragem e plano de revisão</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="KM atual" htmlFor="km_atual" required error={fieldError('km_atual')}>
            <Input id="km_atual" name="km_atual" type="number" inputMode="numeric" min={0} required defaultValue={veiculo?.km_atual ?? 0} />
          </Field>
          <span className="hidden sm:block" />
          <Field label="Revisão a cada (KM)" htmlFor="intervalo_revisao_km" required error={fieldError('intervalo_revisao_km')}>
            <Input id="intervalo_revisao_km" name="intervalo_revisao_km" type="number" inputMode="numeric" min={1} required defaultValue={veiculo?.intervalo_revisao_km ?? 10000} />
          </Field>
          <Field label="Revisão a cada (dias)" htmlFor="intervalo_revisao_dias" required error={fieldError('intervalo_revisao_dias')}>
            <Input id="intervalo_revisao_dias" name="intervalo_revisao_dias" type="number" inputMode="numeric" min={1} required defaultValue={veiculo?.intervalo_revisao_dias ?? 180} />
          </Field>
          <Field
            label="Próxima revisão (KM)"
            htmlFor="proxima_revisao_km"
            error={fieldError('proxima_revisao_km')}
            hint={editing ? undefined : 'Em branco: KM atual + intervalo.'}
          >
            <Input id="proxima_revisao_km" name="proxima_revisao_km" type="number" inputMode="numeric" min={0} defaultValue={veiculo?.proxima_revisao_km ?? ''} />
          </Field>
          <Field
            label="Próxima revisão (data)"
            htmlFor="proxima_revisao_data"
            error={fieldError('proxima_revisao_data')}
            hint={editing ? undefined : 'Em branco: hoje + intervalo.'}
          >
            <Input id="proxima_revisao_data" name="proxima_revisao_data" type="date" defaultValue={veiculo?.proxima_revisao_data ?? ''} />
          </Field>
        </CardContent>
      </Card>

      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={veiculo ? `/veiculos/${veiculo.id}` : '/veiculos'} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Cancelar
        </Link>
        <SubmitButton pending={pending} size="lg">
          {editing ? 'Salvar alterações' : 'Cadastrar veículo'}
        </SubmitButton>
      </div>
    </form>
  );
}
