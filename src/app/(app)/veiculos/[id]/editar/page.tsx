import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireSession } from '@/lib/auth';
import { signedUrlMap } from '@/lib/storage';
import { VeiculoForm } from '../../veiculo-form';

export const metadata: Metadata = { title: 'Editar veículo' };

export default async function EditarVeiculoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireSession();
  const { data: veiculo } = await supabase.from('veiculos').select('*').eq('id', id).maybeSingle();
  if (!veiculo) notFound();

  const [urls, { data: motoristas }] = await Promise.all([
    signedUrlMap(supabase, 'veiculos', [veiculo.foto_geral_url, veiculo.documento_url]),
    supabase.from('motoristas').select('id, nome, filial_id, status, user_id').eq('filial_id', veiculo.filial_id).order('nome'),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={`Editar ${veiculo.placa}`} />
      <VeiculoForm
        filiais={null}
        filialFixaId={profile.filial_id}
        veiculo={veiculo}
        fotoUrl={veiculo.foto_geral_url ? urls[veiculo.foto_geral_url] : null}
        documentoUrl={veiculo.documento_url ? urls[veiculo.documento_url] : null}
        motoristas={motoristas ?? []}
      />
    </div>
  );
}
