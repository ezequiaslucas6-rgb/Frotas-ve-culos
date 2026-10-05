import type { Metadata } from 'next';
import { ChecklistWizard } from '@/components/checklist/checklist-wizard';
import { requireSession } from '@/lib/auth';
import { TIPOS_CHECKLIST } from '@/lib/checklist/etapas';
import { carregarModelos } from '@/lib/checklist/modelos';
import { formatFilial } from '@/lib/format';
import type { SearchParams } from '@/lib/pagination';

export const metadata: Metadata = { title: 'Novo checklist' };

export default async function NovoChecklistPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { supabase, user, isAdmin, isMotorista } = await requireSession({ motorista: true });

  // A RLS já limita ao que o usuário enxerga (supervisor: a própria filial; motorista: os
  // veículos em que é o responsável e o próprio cadastro).
  const [{ data: veiculos }, { data: motoristas }, { modelos }] = await Promise.all([
    supabase.from('vw_veiculos_painel').select('id, filial_id, placa, marca, modelo, km_atual, nome_cidade, uf').order('placa'),
    supabase.from('motoristas').select('id, filial_id, nome').eq('status', 'ativo').order('nome'),
    carregarModelos(supabase),
  ]);

  // com um único veículo (o caso comum do motorista), ele já vem escolhido
  const inicial = (Array.isArray(sp.veiculo) ? sp.veiculo[0] : sp.veiculo) ?? (veiculos?.length === 1 ? veiculos[0]?.id : undefined);
  const tipoParam = Array.isArray(sp.tipo) ? sp.tipo[0] : sp.tipo;
  const tipoInicial = TIPOS_CHECKLIST.find((t) => t.value === tipoParam)?.value;

  return (
    <ChecklistWizard
      userId={user.id}
      veiculoInicialId={inicial}
      tipoInicial={tipoInicial}
      modelos={modelos}
      veiculos={(veiculos ?? []).map(({ nome_cidade, uf, ...v }) => ({
        ...v,
        filialLabel: isAdmin ? formatFilial({ nome_cidade, uf }) : null,
      }))}
      motoristas={motoristas ?? []}
      motoristaFixoId={isMotorista ? (motoristas?.[0]?.id ?? null) : undefined}
    />
  );
}
