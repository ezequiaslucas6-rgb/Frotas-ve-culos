import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { requireSession } from '@/lib/auth';
import { toISODate } from '@/lib/dates';
import { formatFilial } from '@/lib/format';
import type { SearchParams } from '@/lib/pagination';
import { ManutencaoForm } from '../manutencao-form';

export const metadata: Metadata = { title: 'Nova manutenção' };

export default async function NovaManutencaoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireSession();
  const { data } = await supabase
    .from('vw_veiculos_painel')
    .select('id, placa, marca, modelo, km_atual, intervalo_revisao_km, intervalo_revisao_dias, nome_cidade, uf')
    .order('placa');

  const veiculos = (data ?? []).map(({ nome_cidade, uf, ...v }) => ({
    ...v,
    filialLabel: isAdmin ? formatFilial({ nome_cidade, uf }) : null,
  }));
  const inicial = Array.isArray(sp.veiculo) ? sp.veiculo[0] : sp.veiculo;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="Registrar manutenção" description="Lance o serviço realizado e o custo. Os alertas de revisão são recalculados automaticamente." />
      <ManutencaoForm veiculos={veiculos} veiculoInicial={inicial} hoje={toISODate()} />
    </div>
  );
}
