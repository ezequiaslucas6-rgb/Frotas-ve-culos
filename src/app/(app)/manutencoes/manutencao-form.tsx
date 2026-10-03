'use client';

import Link from 'next/link';
import { useState } from 'react';
import { registrarManutencao } from '@/actions/manutencoes';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';
import { formatVeiculo } from '@/lib/format';

export interface VeiculoOption {
  id: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  km_atual: number;
  intervalo_revisao_km: number;
  intervalo_revisao_dias: number;
  filialLabel: string | null;
}

export function ManutencaoForm({ veiculos, veiculoInicial, hoje }: { veiculos: VeiculoOption[]; veiculoInicial?: string; hoje: string }) {
  const { state, pending, onSubmit, fieldError } = useServerForm(registrarManutencao);
  const [veiculoId, setVeiculoId] = useState(veiculoInicial && veiculos.some((v) => v.id === veiculoInicial) ? veiculoInicial : '');
  const [tipo, setTipo] = useState<'preventiva' | 'corretiva'>('preventiva');
  const veiculo = veiculos.find((v) => v.id === veiculoId);
  // KM sugerido acompanha o veículo escolhido (o usuário pode sobrescrever)
  const [km, setKm] = useState<string>(veiculo ? String(veiculo.km_atual) : '');

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Veículo" htmlFor="veiculo_id" required error={fieldError('veiculo_id')} className="sm:col-span-2">
            <Select
              id="veiculo_id"
              name="veiculo_id"
              required
              value={veiculoId}
              onChange={(e) => {
                setVeiculoId(e.target.value);
                const v = veiculos.find((x) => x.id === e.target.value);
                if (v) setKm(String(v.km_atual));
              }}
            >
              <option value="" disabled>
                Selecione o veículo…
              </option>
              {veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {formatVeiculo(v)}
                  {v.filialLabel ? ` — ${v.filialLabel}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tipo" htmlFor="tipo" required error={fieldError('tipo')}>
            <Select id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              <option value="preventiva">Preventiva (revisão)</option>
              <option value="corretiva">Corretiva (reparo)</option>
            </Select>
          </Field>
          <Field label="Data do serviço" htmlFor="data_manutencao" required error={fieldError('data_manutencao')}>
            <Input id="data_manutencao" name="data_manutencao" type="date" defaultValue={hoje} max={hoje} required />
          </Field>

          <Field label="KM no serviço" htmlFor="km_registro" required error={fieldError('km_registro')}>
            <Input id="km_registro" name="km_registro" type="number" inputMode="numeric" min={0} required value={km} onChange={(e) => setKm(e.target.value)} />
          </Field>
          <Field label="Custo (R$)" htmlFor="custo" required error={fieldError('custo')}>
            <Input id="custo" name="custo" inputMode="decimal" placeholder="0,00" required />
          </Field>

          <Field label="Descrição do serviço" htmlFor="descricao" required error={fieldError('descricao')} className="sm:col-span-2">
            <Textarea id="descricao" name="descricao" rows={3} required placeholder="Ex.: troca de óleo e filtros, alinhamento…" />
          </Field>
          <Field label="Oficina / fornecedor" htmlFor="fornecedor" error={fieldError('fornecedor')} className="sm:col-span-2">
            <Input id="fornecedor" name="fornecedor" />
          </Field>

          {tipo === 'preventiva' && veiculo ? (
            <p className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground sm:col-span-2">
              A próxima revisão será agendada automaticamente para <strong>+{veiculo.intervalo_revisao_km.toLocaleString('pt-BR')} km</strong> ou{' '}
              <strong>+{veiculo.intervalo_revisao_dias} dias</strong> (o que ocorrer primeiro).
            </p>
          ) : null}
        </CardContent>
      </Card>

      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/manutencoes" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Cancelar
        </Link>
        <SubmitButton pending={pending} size="lg">
          Registrar manutenção
        </SubmitButton>
      </div>
    </form>
  );
}
