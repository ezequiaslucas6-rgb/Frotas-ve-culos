import { Ban, CalendarDays, CircleAlert, CircleCheck, CircleHelp, TriangleAlert, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateISO } from '@/lib/format';
import type { NivelAlerta, SaudeVeiculo } from '@/lib/maintenance/alerts';
import { descreverSituacaoCnh, type SituacaoCnh } from '@/lib/motoristas/cnh';
import type { Enums } from '@/types/database';

/**
 * Semáforo da frota: Verde = Liberado, Amarelo = Atenção, Vermelho = Manutenção/Avaria.
 * `naoLiberado`: avaria crítica no checklist, veículo bloqueado até o conserto ou a liberação.
 */
export function SaudeBadge({ saude, naoLiberado = false }: { saude: SaudeVeiculo; naoLiberado?: boolean }) {
  if (naoLiberado) {
    return (
      <Badge variant="danger">
        <Ban /> Não liberado
      </Badge>
    );
  }
  switch (saude) {
    case 'liberado':
      return (
        <Badge variant="success">
          <CircleCheck /> Liberado
        </Badge>
      );
    case 'atencao':
      return (
        <Badge variant="warning">
          <TriangleAlert /> Atenção
        </Badge>
      );
    case 'manutencao':
      return (
        <Badge variant="danger">
          <Wrench /> Manutenção/Avaria
        </Badge>
      );
  }
}

export function ChecklistStatusBadge({ status }: { status: Enums<'checklist_status'> }) {
  if (status === 'ok') return <Badge variant="success">Conforme</Badge>;
  if (status === 'atencao') return <Badge variant="warning">Atenção</Badge>;
  return <Badge variant="danger">Avaria</Badge>;
}

/** Diário / Semanal / Mensal. */
export function ChecklistTipoBadge({ tipo }: { tipo: Enums<'checklist_tipo'> }) {
  const label = tipo === 'mensal' ? 'Mensal' : tipo === 'semanal' ? 'Semanal' : 'Diário';
  return (
    <Badge variant={tipo === 'diario' ? 'secondary' : 'default'}>
      <CalendarDays /> {label}
    </Badge>
  );
}

export function AlertaBadge({ nivel }: { nivel: NivelAlerta }) {
  if (nivel === 'vencido')
    return (
      <Badge variant="danger">
        <CircleAlert /> Revisão vencida
      </Badge>
    );
  if (nivel === 'proximo')
    return (
      <Badge variant="warning">
        <TriangleAlert /> Revisão próxima
      </Badge>
    );
  return <Badge variant="success">Em dia</Badge>;
}

export function MotoristaStatusBadge({ status }: { status: Enums<'motorista_status'> }) {
  const map = {
    ativo: ['success', 'Ativo'],
    inativo: ['secondary', 'Inativo'],
    afastado: ['warning', 'Afastado'],
    ferias: ['outline', 'Férias'],
  } as const;
  const [variant, label] = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

/** Situação da CNH pela validade; `detalhe` acrescenta a data/prazo ao texto. */
export function CnhBadge({ situacao, detalhe = false }: { situacao: SituacaoCnh; detalhe?: boolean }) {
  switch (situacao.nivel) {
    case 'sem_dados':
      return (
        <Badge variant="secondary">
          <CircleHelp /> CNH sem validade
        </Badge>
      );
    case 'vencida':
      return (
        <Badge variant="danger">
          <CircleAlert /> CNH vencida{detalhe ? ` · ${formatDateISO(situacao.validade)}` : ''}
        </Badge>
      );
    case 'vence':
      return (
        <Badge variant="warning">
          <TriangleAlert /> CNH: {descreverSituacaoCnh(situacao).toLowerCase()}
        </Badge>
      );
    case 'ok':
      return (
        <Badge variant="success">
          <CircleCheck /> CNH válida{detalhe ? ` até ${formatDateISO(situacao.validade)}` : ''}
        </Badge>
      );
  }
}
