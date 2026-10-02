import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { requireSession } from '@/lib/auth';
import { VeiculoForm } from '../veiculo-form';

export const metadata: Metadata = { title: 'Novo veículo' };

export default async function NovoVeiculoPage() {
  const { supabase, isAdmin, profile } = await requireSession();
  const [{ data: filiais }, { data: motoristas }] = await Promise.all([
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
    supabase.from('motoristas').select('id, nome, filial_id, status, user_id').order('nome'),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="Novo veículo" />
      <VeiculoForm filiais={filiais} filialFixaId={profile.filial_id} motoristas={motoristas ?? []} />
    </div>
  );
}
