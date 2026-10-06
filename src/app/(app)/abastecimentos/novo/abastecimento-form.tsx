'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Gauge, TriangleAlert } from 'lucide-react';
import { registrarAbastecimento } from '@/actions/abastecimentos';
import { lerCupom } from '@/actions/cupom';
import { LeituraCupom, type EstadoLeitura } from '@/components/abastecimentos/leitura-cupom';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { FileUpload } from '@/components/ui/file-upload';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useServerForm } from '@/hooks/use-server-form';
import { COMBUSTIVEIS, formatPrecoLitro, parseDecimalBR, type Combustivel } from '@/lib/abastecimento/consumo';
import { calcularValores, conferirKmCupom, conferirPlaca, paraCampo, type RegistroLeitura } from '@/lib/abastecimento/cupom';
import { addDays } from '@/lib/dates';
import { formatBRL, formatKm, formatNumber } from '@/lib/format';
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
  /** leitura automática do cupom ligada no servidor (chave do Gemini) */
  leituraAutomatica: boolean;
}

/** Diferença de KM que merece um aviso (provável erro de digitação). */
const SALTO_SUSPEITO = 3000;
/** Data lida do cupom só é usada se for recente (evita ano/mês trocados). */
const DIAS_DATA_CUPOM = 60;
/** Resultado e quanto levou (ms). */
async function cronometrar<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const inicio = performance.now();
  const r = await fn();
  return [r, Math.round(performance.now() - inicio)];
}

const CODIGOS_SEM_NOVA_TENTATIVA = new Set(['sem_chave', 'chave_invalida', 'regiao', 'modelo', 'limite', 'limite_usuario', 'recusado']);

export function AbastecimentoForm({ veiculos, motoristas, veiculoInicial, combustivelInicial, hoje, leituraAutomatica }: AbastecimentoFormProps) {
  const { state, pending, onSubmit, fieldError } = useServerForm(registrarAbastecimento);
  const [veiculoId, setVeiculoId] = useState(veiculoInicial ?? (veiculos.length === 1 ? veiculos[0]!.id : ''));
  const [data, setData] = useState(hoje);
  const [km, setKm] = useState('');
  const [litros, setLitros] = useState('');
  const [valorBruto, setValorBruto] = useState('');
  const [desconto, setDesconto] = useState('');
  const [posto, setPosto] = useState('');
  const [combustivel, setCombustivel] = useState<Combustivel>(combustivelInicial);
  const [leitura, setLeitura] = useState<EstadoLeitura | null>(null);
  const [registro, setRegistro] = useState<RegistroLeitura | null>(null);
  const cupomAtual = useRef<string | null>(null);
  const veiculo = veiculos.find((v) => v.id === veiculoId);

  const kmNum = km === '' ? null : Number(km);
  const diferenca = veiculo && kmNum != null && Number.isFinite(kmNum) ? kmNum - veiculo.km_atual : null;
  const unidade = combustivel === 'gnv' ? 'm³' : 'L';
  const descontoNum = parseDecimalBR(desconto);
  const valores = calcularValores({
    litros: parseDecimalBR(litros),
    valorBruto: parseDecimalBR(valorBruto),
    desconto: descontoNum && Number.isFinite(descontoNum) ? descontoNum : 0,
  });

  async function ler(caminho: string, envio?: { preparo: number; envio: number }) {
    if (!veiculo) return;
    cupomAtual.current = caminho;
    setLeitura({ fase: 'lendo' });
    setRegistro(null);
    const [r, leituraMs] = await cronometrar(() =>
      lerCupom({ veiculoId: veiculo.id, caminho }).catch(
        (): Awaited<ReturnType<typeof lerCupom>> => ({ ok: false, codigo: 'rede', mensagem: 'Sem conexão para ler o cupom. Preencha à mão ou tente de novo.' }),
      ),
    );
    if (cupomAtual.current !== caminho) return; // trocaram a foto enquanto lia
    if (!r.ok) {
      setLeitura({ fase: 'erro', mensagem: r.mensagem, podeTentar: !CODIGOS_SEM_NOVA_TENTATIVA.has(r.codigo) });
      return;
    }

    // preenche os campos com o que foi lido (a pessoa confere e corrige antes de registrar)
    const { registro: reg } = r;
    const l = reg.leitura;
    // placa impressa (notas de convênio) tem de ser a do veículo escolhido
    const placa = conferirPlaca(l.placa, veiculo.placa);
    let c = placa ? { ...r.calculo, conferencias: [...r.calculo.conferencias, placa], confiavel: r.calculo.confiavel && placa.ok } : r.calculo;
    // KM impresso é digitado pelo frentista (e pode ser mal lido): só entra se combinar com o veículo
    const kmCupom = conferirKmCupom(l.km, veiculo.km_atual);
    if (kmCupom.aviso) c = { ...c, avisos: [...c.avisos, kmCupom.aviso], confiavel: false };
    const preenchidos: string[] = [];
    if (c.litros) {
      setLitros(paraCampo(c.litros, 3));
      preenchidos.push('quantidade');
    }
    if (c.valorBruto) {
      setValorBruto(paraCampo(c.valorBruto));
      setDesconto(c.desconto > 0 ? paraCampo(c.desconto) : '');
      preenchidos.push('valor total', 'desconto');
    }
    if (l.combustivel && l.combustivel !== 'outro') {
      setCombustivel(l.combustivel);
      preenchidos.push('combustível');
    }
    if (l.data && l.data <= hoje && l.data >= addDays(hoje, -DIAS_DATA_CUPOM)) {
      setData(l.data);
      preenchidos.push('data');
    }
    if (l.posto && !posto.trim()) {
      setPosto(l.posto.slice(0, 120));
      preenchidos.push('posto');
    }
    if (kmCupom.km && !km) {
      setKm(String(kmCupom.km));
      preenchidos.push('KM');
    }
    setRegistro(reg);
    setLeitura({
      fase: 'pronta',
      calculo: c,
      preenchidos,
      tempos: { preparo: envio?.preparo, envio: envio?.envio, leitura: leituraMs, ia: r.tempos?.ia },
      modelo: reg.modelo,
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="leitura_cupom" value={registro ? JSON.stringify(registro) : ''} />
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <Select
                id="veiculo_id"
                name="veiculo_id"
                value={veiculoId}
                onChange={(e) => {
                  // a foto do cupom é por veículo: trocar o veículo descarta a foto e a leitura
                  setVeiculoId(e.target.value);
                  cupomAtual.current = null;
                  setLeitura(null);
                  setRegistro(null);
                }}
                required
              >
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

          {/* a foto vem primeiro: com a leitura automática, ela preenche os valores abaixo */}
          <div className="flex flex-col gap-3 sm:col-span-2">
            <FileUpload
              key={veiculoId}
              name="comprovante_path"
              label="Foto do cupom / comprovante"
              bucket="abastecimentos"
              pasta={veiculo ? `${veiculo.filial_id}/${veiculo.id}` : null}
              arquivo="cupom"
              // folha A4 (DANFE) tem letra miúda: mais resolução que as outras fotos
              maxDimension={2600}
              digitalizar
              semPastaMsg="Selecione o veículo antes de enviar o comprovante."
              accept="image/*"
              capture
              hint={
                !veiculo
                  ? 'Selecione o veículo primeiro.'
                  : leituraAutomatica
                    ? 'Fotografe o cupom inteiro, de perto e sem reflexo: os valores são lidos sozinhos.'
                    : 'Fotografe o cupom inteiro, de perto e sem reflexo.'
              }
              onEnviado={(caminho, tempos) => {
                cupomAtual.current = caminho;
                setRegistro(null);
                setLeitura(null);
                if (caminho && leituraAutomatica) void ler(caminho, tempos);
              }}
            />
            {leitura ? (
              <LeituraCupom estado={leitura} unidade={unidade} onTentarDeNovo={() => cupomAtual.current && void ler(cupomAtual.current)} />
            ) : null}
          </div>

          <Field label="Data" htmlFor="data_abastecimento" required error={fieldError('data_abastecimento')}>
            <Input
              id="data_abastecimento"
              name="data_abastecimento"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              max={hoje}
              required
            />
          </Field>
          <Field
            label="KM no hodômetro"
            htmlFor="km"
            required
            error={fieldError('km')}
            hint={
              veiculo
                ? `Último registrado: ${formatKm(veiculo.km_atual)}${registro?.leitura.km ? ` · no cupom: ${formatKm(registro.leitura.km)}` : ''}`
                : undefined
            }
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
          <Field label={`Quantidade (${unidade})`} htmlFor="litros" required error={fieldError('litros')} className="sm:col-span-2">
            <Input
              id="litros"
              name="litros"
              inputMode="decimal"
              placeholder="0,000"
              value={litros}
              onChange={(e) => setLitros(e.target.value)}
              required
              aria-invalid={!!fieldError('litros')}
            />
          </Field>
          <Field
            label="Valor total (R$)"
            htmlFor="valor_bruto"
            required
            error={fieldError('valor_bruto')}
            hint={valores.precoBomba ? `Bomba: ${formatPrecoLitro(valores.precoBomba)}/${unidade}` : 'Como está no cupom, antes do desconto.'}
          >
            <Input
              id="valor_bruto"
              name="valor_bruto"
              inputMode="decimal"
              placeholder="0,00"
              value={valorBruto}
              onChange={(e) => setValorBruto(e.target.value)}
              required
              aria-invalid={!!fieldError('valor_bruto')}
            />
          </Field>
          <Field label="Desconto (R$)" htmlFor="desconto" error={fieldError('desconto')} hint="Deixe em branco se não houve desconto.">
            <Input
              id="desconto"
              name="desconto"
              inputMode="decimal"
              placeholder="0,00"
              value={desconto}
              onChange={(e) => setDesconto(e.target.value)}
              aria-invalid={!!fieldError('desconto')}
            />
          </Field>

          {/* as contas que antes eram feitas à mão */}
          <dl aria-label="Valores calculados" className="grid grid-cols-2 gap-3 rounded-xl bg-primary/10 px-3.5 py-3 sm:col-span-2">
            <div>
              <dt className="text-xs text-muted-foreground">Valor líquido (pago)</dt>
              <dd className="text-lg font-bold tabular-nums">{valores.valorLiquido != null && valores.valorLiquido > 0 ? formatBRL(valores.valorLiquido) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Unitário com desconto</dt>
              <dd className="text-lg font-bold tabular-nums">
                {valores.unitarioComDesconto ? `${formatPrecoLitro(valores.unitarioComDesconto)}/${unidade}` : '—'}
              </dd>
            </div>
          </dl>

          <Checkbox
            name="tanque_cheio"
            defaultChecked
            label="Completei o tanque"
            hint="Desmarque se foi abastecimento parcial (o consumo em km/l usa os tanques cheios)."
            className="sm:col-span-2"
          />
          <Field label="Posto" htmlFor="posto" error={fieldError('posto')} className="sm:col-span-2">
            <Input id="posto" name="posto" maxLength={120} placeholder="Ex.: Posto Ipiranga BR-116" value={posto} onChange={(e) => setPosto(e.target.value)} />
          </Field>
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
