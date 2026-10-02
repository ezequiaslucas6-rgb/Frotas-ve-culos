'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Gauge, TriangleAlert } from 'lucide-react';
import { registrarAbastecimento } from '@/actions/abastecimentos';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { FileUpload } from '@/components/ui/file-upload';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';
import { COMBUSTIVEIS, formatPrecoLitro, parseDecimalBR, type Combustivel } from '@/lib/abastecimento/consumo';
import { formatKm, formatNumber } from '@/lib/format';
import { formatPlaca } from '@/lib/validators/documentos';

interface VeiculoOpcao {
  id: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  km_atual: number;
  filial_id: string;
  motorista_id: string | null;
}

interface AbastecimentoFormProps {
  veiculos: VeiculoOpcao[];
  /** null para o motorista (o servidor usa o próprio cadastro) */
  motoristas: Array<{ id: string; nome: string; filial_id: string }> | null;
  veiculoInicial: string | null;
  combustivelInicial: Combustivel;
  hoje: string;
}

/** Diferença de KM que merece um aviso (provável erro de digitação). */
const SALTO_SUSPEITO = 3000;

export function AbastecimentoForm({ veiculos, motoristas, veiculoInicial, combustivelInicial, hoje }: AbastecimentoFormProps) {
  const { state, pending, onSubmit, fieldError } = useServerForm(registrarAbastecimento);
  const [veiculoId, setVeiculoId] = useState(veiculoInicial ?? (veiculos.length === 1 ? veiculos[0]!.id : ''));
  const [km, setKm] = useState('');
  const [litros, setLitros] = useState('');
  const [valor, setValor] = useState('');
  const [combustivel, setCombustivel] = useState<Combustivel>(combustivelInicial);
  const veiculo = veiculos.find((v) => v.id === veiculoId);

  const kmNum = km === '' ? null : Number(km);
  const diferenca = veiculo && kmNum != null && Number.isFinite(kmNum) ? kmNum - veiculo.km_atual : null;
  const litrosNum = parseDecimalBR(litros);
  const valorNum = parseDecimalBR(valor);
  const preco = litrosNum && valorNum && litrosNum > 0 ? valorNum / litrosNum : null;
  const unidade = combustivel === 'gnv' ? 'm³' : 'L';

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {veiculos.length === 1 && veiculo ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-raised px-3.5 py-3 sm:col-span-2">
              <input type="hidden" name="veiculo_id" value={veiculo.id} />
              <div>
                <p className="font-bold tracking-wide">{formatPlaca(veiculo.placa)}</p>
                <p className="text-xs text-muted-foreground">{[veiculo.marca, veiculo.modelo].filter(Boolean).join(' ') || 'Veículo'}</p>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Gauge className="size-4" /> {formatKm(veiculo.km_atual)}
              </p>
            </div>
          ) : (
            <Field label="Veículo" htmlFor="veiculo_id" required error={fieldError('veiculo_id')} className="sm:col-span-2">
              <Select id="veiculo_id" name="veiculo_id" value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)} required>
                <option value="" disabled>
                  Selecione o veículo…
                </option>
                {veiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatPlaca(v.placa)} {[v.marca, v.modelo].filter(Boolean).join(' ')}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {motoristas ? (
            <Field label="Motorista" htmlFor="motorista_id" error={fieldError('motorista_id')} className="sm:col-span-2">
              <Select key={veiculoId} id="motorista_id" name="motorista_id" defaultValue={veiculo?.motorista_id ?? ''} disabled={!veiculo}>
                <option value="">Não informado</option>
                {motoristas
                  .filter((m) => m.filial_id === veiculo?.filial_id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Data" htmlFor="data_abastecimento" required error={fieldError('data_abastecimento')}>
            <Input id="data_abastecimento" name="data_abastecimento" type="date" defaultValue={hoje} max={hoje} required />
          </Field>
          <Field
            label="KM no hodômetro"
            htmlFor="km"
            required
            error={fieldError('km')}
            hint={veiculo ? `Último registrado: ${formatKm(veiculo.km_atual)}` : undefined}
          >
            <Input
              id="km"
              name="km"
              type="number"
              inputMode="numeric"
              min={0}
              value={km}
              onChange={(e) => setKm(e.target.value)}
              required
              aria-invalid={!!fieldError('km')}
            />
          </Field>
          {diferenca != null && (diferenca < 0 || diferenca > SALTO_SUSPEITO) ? (
            <p className="flex items-start gap-2 rounded-xl bg-warning/15 px-3.5 py-2.5 text-sm text-warning-text sm:col-span-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {diferenca < 0
                ? `O KM está ${formatNumber(-diferenca)} km abaixo do último registro. Confira o hodômetro.`
                : `São ${formatNumber(diferenca)} km desde o último registro. Confira se digitou certo.`}
            </p>
          ) : null}

          <Field label="Combustível" htmlFor="combustivel" required error={fieldError('combustivel')} className="sm:col-span-2">
            <Select id="combustivel" name="combustivel" value={combustivel} onChange={(e) => setCombustivel(e.target.value as Combustivel)}>
              {COMBUSTIVEIS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Quantidade (${unidade})`} htmlFor="litros" required error={fieldError('litros')}>
            <Input
              id="litros"
              name="litros"
              inputMode="decimal"
              placeholder="0,00"
              value={litros}
              onChange={(e) => setLitros(e.target.value)}
              required
              aria-invalid={!!fieldError('litros')}
            />
          </Field>
          <Field
            label="Valor total (R$)"
            htmlFor="valor_total"
            required
            error={fieldError('valor_total')}
            hint={preco && Number.isFinite(preco) ? `${formatPrecoLitro(preco)} por ${unidade}` : undefined}
          >
            <Input
              id="valor_total"
              name="valor_total"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              required
              aria-invalid={!!fieldError('valor_total')}
            />
          </Field>
          <Checkbox
            name="tanque_cheio"
            defaultChecked
            label="Completei o tanque"
            hint="Desmarque se foi abastecimento parcial (o consumo em km/l usa os tanques cheios)."
            className="sm:col-span-2"
          />
          <Field label="Posto" htmlFor="posto" error={fieldError('posto')} className="sm:col-span-2">
            <Input id="posto" name="posto" maxLength={120} placeholder="Ex.: Posto Ipiranga BR-116" />
          </Field>
          <div className="sm:col-span-2">
            <FileUpload
              name="comprovante_path"
              label="Foto do cupom / comprovante"
              bucket="abastecimentos"
              pasta={veiculo ? `${veiculo.filial_id}/${veiculo.id}` : null}
              arquivo="cupom"
              nomeUnico
              maxDimension={1800}
              semPastaMsg="Selecione o veículo antes de enviar o comprovante."
              accept="image/*"
              capture
              hint={veiculo ? 'Tire a foto do cupom fiscal.' : 'Selecione o veículo primeiro.'}
            />
          </div>
          <Field label="Observação" htmlFor="observacao" error={fieldError('observacao')} className="sm:col-span-2">
            <Textarea id="observacao" name="observacao" rows={2} maxLength={1000} />
          </Field>
        </CardContent>
      </Card>

      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/abastecimentos" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Cancelar
        </Link>
        <SubmitButton pending={pending} size="lg" pendingText="Registrando…">
          Registrar abastecimento
        </SubmitButton>
      </div>
    </form>
  );
}
