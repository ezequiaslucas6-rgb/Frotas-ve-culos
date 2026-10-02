import type { Metadata } from 'next';
import { ChecklistWizard } from '@/components/checklist/checklist-wizard';
import { requireSession } from '@/lib/auth';
import { formatFilial } from '@/lib/format';
import type { SearchParams } from '@/lib/pagination';

export const metadata: Metadata = { title: 'Novo checklist' };

export default async function NovoChecklistPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { supabase, user, isAdmin } = await requireSession();

  // A RLS já limita ao que o usuário enxerga (supervisor: apenas a própria filial).
  const [{ data: veiculos }, { data: motoristas }] = await Promise.all([
    supabase.from('vw_veiculos_painel').select('id, filial_id, placa, marca, modelo, km_atual, nome_cidade, uf').order('placa'),
    supabase.from('motoristas').select('id, filial_id, nome').eq('status', 'ativo').order('nome'),
  ]);

  const inicial = Array.isArray(sp.veiculo) ? sp.veiculo[0] : sp.veiculo;

  return (
    <ChecklistWizard
      userId={user.id}
      veiculoInicialId={inicial}
      veiculos={(veiculos ?? []).map(({ nome_cidade, uf, ...v }) => ({
        ...v,
        filialLabel: isAdmin ? formatFilial({ nome_cidade, uf }) : null,
      }))}
      motoristas={motoristas ?? []}
    />
  );
}
