'use client';

import { CircleCheck, Loader2, RefreshCw, ScanText, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPrecoLitro } from '@/lib/abastecimento/consumo';
import type { CalculoCupom, CampoCorrigivel } from '@/lib/abastecimento/cupom';
import { formatBRL, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Tempo de cada etapa, em ms (preparo da foto no celular, envio, leitura e, dentro dela, a IA). */
export interface TemposLeitura {
  preparo?: number;
  envio?: number;
  leitura?: number;
  ia?: number;
}

export type EstadoLeitura =
  | { fase: 'lendo' }
  | { fase: 'pronta'; calculo: CalculoCupom; preenchidos: string[]; nota?: string; tempos?: TemposLeitura; modelo?: string }
  | { fase: 'erro'; mensagem: string; podeTentar: boolean };

const valor = (v: number | null, f: (n: number) => string) => (v == null ? '—' : f(v));
const segundos = (ms: number) => `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;

/** "Lido em 4,3 s (foto 1,2 s · envio 0,6 s · leitura 2,5 s) por gemini-flash-latest" */
export function descreverTempos(t: TemposLeitura | undefined, modelo?: string): string | null {
  if (!t?.leitura) return null;
  const partes = [
    t.preparo != null ? `foto ${segundos(t.preparo)}` : null,
    t.envio != null ? `envio ${segundos(t.envio)}` : null,
    `leitura ${segundos(t.leitura)}`,
  ].filter(Boolean);
  const total = (t.preparo ?? 0) + (t.envio ?? 0) + t.leitura;
  return `Lido em ${segundos(total)} (${partes.join(' · ')})${modelo ? ` por ${modelo}` : ''}.`;
}

/** Resultado da leitura automática do cupom: os seis valores, as conferências e os avisos. */
export function LeituraCupom({ estado, unidade, onTentarDeNovo }: { estado: EstadoLeitura; unidade: string; onTentarDeNovo: () => void }) {
  if (estado.fase === 'lendo') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl bg-primary/10 px-4 py-3 text-sm">
        <Loader2 className="size-5 shrink-0 animate-spin text-icone" />
        <div>
          <p className="font-medium">Lendo o cupom…</p>
          <p className="text-xs text-muted-foreground">Leva alguns segundos. Os valores aparecem aqui e nos campos abaixo.</p>
        </div>
      </div>
    );
  }

  if (estado.fase === 'erro') {
    return (
      <div role="status" className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3 text-sm">
        <ScanText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-muted-foreground">{estado.mensagem}</p>
        {estado.podeTentar ? (
          <Button type="button" variant="outline" size="sm" onClick={onTentarDeNovo}>
            <RefreshCw /> Ler de novo
          </Button>
        ) : null}
      </div>
    );
  }

  const c = estado.calculo;
  const corrigido = (campo: CampoCorrigivel) => c.correcoes.find((x) => x.campo === campo);
  const litros = (n: number) => `${formatNumber(n)} ${unidade}`;
  const itens: Array<{ rotulo: string; valor: string; destaque?: boolean; lido?: string }> = [
    { rotulo: 'Litros', valor: valor(c.litros, litros), lido: valor(corrigido('litros')?.lido ?? null, litros) },
    { rotulo: 'Valor total', valor: valor(c.valorBruto, formatBRL), lido: valor(corrigido('valorBruto')?.lido ?? null, formatBRL) },
    { rotulo: 'Desconto', valor: c.desconto > 0 ? formatBRL(c.desconto) : 'Sem desconto', lido: valor(corrigido('desconto')?.lido ?? null, formatBRL) },
    { rotulo: 'Valor a pagar', valor: valor(c.valorAPagar, formatBRL), lido: valor(corrigido('liquido')?.lido ?? null, formatBRL) },
    { rotulo: 'Valor líquido', valor: valor(c.valorLiquido, formatBRL), destaque: true },
    { rotulo: `Unitário com desconto`, valor: valor(c.unitarioComDesconto, (n) => `${formatPrecoLitro(n)}/${unidade}`), destaque: true },
  ];
  const tempos = descreverTempos(estado.tempos, estado.modelo);

  return (
    <section aria-label="Leitura do cupom" className="rounded-2xl border border-border bg-raised/40 p-4">
      <div className="flex items-center gap-2">
        <ScanText className="size-5 text-icone" />
        <h3 className="font-semibold">Leitura do cupom</h3>
        <Badge variant={c.confiavel ? 'success' : 'warning'} className="ml-auto">
          {c.confiavel ? 'Conferido' : c.correcoes.length ? 'Corrigido: confira' : 'Confira'}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {itens.map((i) => {
          const foiCorrigido = i.lido != null && i.lido !== '—';
          return (
            <div
              key={i.rotulo}
              className={cn(
                'min-w-0',
                i.destaque && 'rounded-xl bg-primary/10 px-2.5 py-1.5',
                foiCorrigido && 'rounded-xl bg-warning/15 px-2.5 py-1.5 ring-1 ring-warning/50',
              )}
            >
              <dt className="text-xs text-muted-foreground">{i.rotulo}</dt>
              <dd className={cn('truncate font-semibold tabular-nums', i.destaque && 'text-base')}>{i.valor}</dd>
              {foiCorrigido ? <dd className="truncate text-xs text-warning-text">corrigido · lido {i.lido}</dd> : null}
            </div>
          );
        })}
      </dl>

      {c.conferencias.length || c.avisos.length ? (
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {c.conferencias.map((x) => (
            <li key={x.texto} className={cn('flex items-start gap-2', x.ok ? 'text-success-text' : 'text-warning-text')}>
              {x.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
              {x.texto}
            </li>
          ))}
          {c.avisos.map((a) => (
            <li key={a} className="flex items-start gap-2 text-warning-text">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {a}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        {estado.nota ??
          (estado.preenchidos.length
            ? `Preenchido abaixo: ${estado.preenchidos.join(', ')}. Confira com o cupom antes de registrar.`
            : 'Nada foi preenchido automaticamente: confira a foto e digite os valores.')}
      </p>
      {tempos ? <p className="mt-1 text-xs text-muted-foreground">{tempos}</p> : null}
    </section>
  );
}
