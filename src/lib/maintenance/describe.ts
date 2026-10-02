import { formatNumber } from '@/lib/format';
import type { AlertaRevisao } from './alerts';

/** Texto curto do alerta, ex.: "Faltam 450 km · Vence em 8 dias". */
export function descreverAlerta(alerta: AlertaRevisao, apenasDisparados = true): string {
  const partes: string[] = [];

  if (alerta.kmRestantes != null && (!apenasDisparados || alerta.motivos.includes('km'))) {
    partes.push(
      alerta.kmRestantes <= 0
        ? `Excedeu ${formatNumber(Math.abs(alerta.kmRestantes))} km`
        : `Faltam ${formatNumber(alerta.kmRestantes)} km`,
    );
  }
  if (alerta.diasRestantes != null && (!apenasDisparados || alerta.motivos.includes('periodo'))) {
    const d = alerta.diasRestantes;
    partes.push(d < 0 ? `Vencida há ${-d} dia${d === -1 ? '' : 's'}` : d === 0 ? 'Vence hoje' : `Vence em ${d} dia${d === 1 ? '' : 's'}`);
  }
  return partes.join(' · ') || 'Sem plano de revisão';
}
