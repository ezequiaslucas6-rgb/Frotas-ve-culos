import { Fuel, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { combustivelLabel, formatKmL, formatLitros, formatPrecoLitro, type Combustivel } from '@/lib/abastecimento/consumo';
import { formatBRL, formatDateISO, formatKm } from '@/lib/format';
import { formatPlaca } from '@/lib/validators/documentos';

export interface ItemAbastecimento {
  id: string;
  data_abastecimento: string;
  km: number;
  litros: number;
  valor_total: number;
  preco_litro: number;
  combustivel: Combustivel;
  tanque_cheio: boolean;
  posto: string | null;
  comprovante_url: string | null;
  veiculos?: { placa: string } | null;
  motoristas?: { nome: string } | null;
}

/**
 * Lista de abastecimentos (celular e desktop). `consumo` traz o km/l dos lançamentos
 * que fecham um ciclo de tanque cheio; `urls` as URLs assinadas dos comprovantes.
 */
export function ListaAbastecimentos({
  itens,
  consumo = {},
  urls = {},
  mostrarVeiculo = false,
  mostrarMotorista = false,
  acoes,
}: {
  itens: ItemAbastecimento[];
  consumo?: Record<string, number>;
  urls?: Record<string, string>;
  mostrarVeiculo?: boolean;
  mostrarMotorista?: boolean;
  acoes?: (item: ItemAbastecimento) => React.ReactNode;
}) {
  return (
    <ul className="divide-y divide-border/60">
      {itens.map((a) => {
        const comprovante = a.comprovante_url ? urls[a.comprovante_url] : undefined;
        const kml = consumo[a.id];
        return (
          <li key={a.id} className="flex items-start gap-3 py-3.5">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-icone/15 text-icone">
              <Fuel className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate font-semibold">
                  {formatDateISO(a.data_abastecimento)}
                  {mostrarVeiculo && a.veiculos ? <span className="text-muted-foreground"> · {formatPlaca(a.veiculos.placa)}</span> : null}
                </p>
                <p className="shrink-0 font-semibold tabular-nums">{formatBRL(Number(a.valor_total))}</p>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
                <p className="truncate">
                  {formatLitros(Number(a.litros), a.combustivel)} {combustivelLabel(a.combustivel)} ·{' '}
                  {formatPrecoLitro(Number(a.preco_litro))}/{a.combustivel === 'gnv' ? 'm³' : 'L'}
                </p>
                {kml ? <p className="shrink-0 font-medium text-foreground tabular-nums">{formatKmL(kml)}</p> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{formatKm(a.km)}</span>
                {a.posto ? <span>· {a.posto}</span> : null}
                {mostrarMotorista ? <span>· {a.motoristas?.nome ?? 'Sem motorista'}</span> : null}
                {a.tanque_cheio ? null : <Badge variant="secondary">Parcial</Badge>}
                {comprovante ? (
                  <a
                    href={comprovante}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <Receipt className="size-3.5" /> Comprovante
                  </a>
                ) : null}
                {acoes ? <span className="ml-auto">{acoes(a)}</span> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
