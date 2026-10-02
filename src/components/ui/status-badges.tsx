import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateISO } from '@/lib/format';
import type { NivelAlerta, SaudeVeiculo } from '@/lib/maintenance/alerts';
import { descreverSituacaoCnh, type SituacaoCnh } from '@/lib/motoristas/cnh';
import type { Enums } from '@/types/database';

/** Semáforo da frota: Verde = Liberado, Amarelo = Atenção, Vermelho = Manutenção/Avaria. */
export function SaudeBadge({ saude }: { saude: SaudeVeiculo }) {
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
