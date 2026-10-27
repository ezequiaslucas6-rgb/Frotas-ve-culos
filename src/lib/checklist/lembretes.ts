/**
 * Lembretes do app (notificação do celular): o APK pergunta ao servidor às 08:00 e às 08:30
 * (horário de Pimenta Bueno) o que avisar. Funções puras.
 *
 *  - 08:00, motorista: o checklist do dia de cada veículo dele (semanal no fim de semana,
 *    semanal atrasado, ou o diário até as 08:30). Nada se já fez ou se hoje é a folga dele.
 *  - 08:30, supervisor/admin: quantos veículos fizeram o diário e quantos esperam a decisão
 *    de liberar ou não (e os não liberados por falta do semanal).
 */
import { formatPlaca } from '@/lib/validators/documentos';
import { PRAZO_DIARIO, type SituacaoDiaria, type SituacaoSemanal } from './cobranca';

export type Momento = '0800' | '0830';

export interface Notificacao {
  /** identifica a notificação no aparelho (a do mesmo assunto substitui a anterior) */
  id: string;
  titulo: string;
  texto: string;
  /** caminho no sistema aberto ao tocar */
  url: string;
}

export interface VeiculoLembrete {
  id: string;
  placa: string;
  semanal: SituacaoSemanal;
  diaria: SituacaoDiaria;
  /** parado por avaria (aguardando conserto) */
  parado: boolean;
}

/** O que avisar ao motorista às 08:00 (um aviso por veículo, só se tiver algo a fazer). */
export function lembretesMotorista(veiculos: readonly VeiculoLembrete[]): Notificacao[] {
  return veiculos
    .filter((v) => !v.parado && v.diaria !== 'folga')
    .flatMap((v): Notificacao[] => {
      const placa = formatPlaca(v.placa);
      if (v.semanal === 'atrasado') {
        return [
          {
            id: `semanal-${v.id}`,
            titulo: `${placa} não liberado`,
            texto: 'Falta o checklist semanal do fim de semana. Faça agora para liberar o veículo.',
            url: `/checklists/novo?veiculo=${v.id}&tipo=semanal`,
          },
        ];
      }
      if (v.semanal === 'fazer') {
        return [
          {
            id: `semanal-${v.id}`,
            titulo: 'Hoje é dia do checklist semanal',
            texto: `${placa}: obrigatório até domingo. Ele já vale como o diário de hoje.`,
            url: `/checklists/novo?veiculo=${v.id}&tipo=semanal`,
          },
        ];
      }
      if (v.diaria === 'feito') return [];
      return [
        {
          id: `diario-${v.id}`,
          titulo: 'Bom dia! Hora do checklist',
          texto: `Faça o checklist diário do ${placa} até as ${PRAZO_DIARIO}, antes de sair.`,
          url: `/checklists/novo?veiculo=${v.id}&tipo=diario`,
        },
      ];
    });
}

/** Resumo para o supervisor às 08:30 (um aviso só). */
export function lembreteSupervisor(veiculos: readonly VeiculoLembrete[]): Notificacao[] {
  const operando = veiculos.filter((v) => !v.parado);
  // motorista de folga hoje não entra na conta do diário
  const emServico = operando.filter((v) => v.diaria !== 'folga');
  const semanal = operando.filter((v) => v.semanal === 'atrasado').length;
  if (!emServico.length && !semanal) return [];
  const feitos = emServico.filter((v) => v.diaria === 'feito').length;
  const decidir = emServico.filter((v) => v.diaria === 'decidir').length;
  const partes = emServico.length ? [`${feitos} de ${emServico.length} veículos fizeram o checklist diário.`] : [];
  if (decidir) partes.push(`${decidir} sem checklist: decida se estão liberados hoje.`);
  if (semanal) partes.push(`${semanal} não liberado(s) por falta do semanal.`);
  return [
    {
      id: 'resumo-diario',
      titulo: decidir || semanal ? 'Checklist de hoje: decisão pendente' : 'Checklist de hoje: tudo em dia',
      texto: partes.join(' '),
      url: '/checklists/hoje',
    },
  ];
}
