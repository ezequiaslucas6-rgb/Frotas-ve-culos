import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireSession } from '@/lib/auth';
import { signedUrlMap } from '@/lib/storage';
import { MotoristaForm } from '../../motorista-form';

export const metadata: Metadata = { title: 'Editar motorista' };

export default async function EditarMotoristaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireSession();
  const { data: motorista } = await supabase.from('motoristas').select('*').eq('id', id).maybeSingle();
  if (!motorista) notFound();
  const urls = await signedUrlMap(supabase, 'motoristas', [motorista.cnh_frente_url, motorista.cnh_verso_url]);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={`Editar ${motorista.nome}`} />
      <MotoristaForm
        filiais={null}
        filialFixaId={motorista.filial_id}
        motorista={motorista}
        cnhFrenteUrl={motorista.cnh_frente_url ? urls[motorista.cnh_frente_url] : null}
        cnhVersoUrl={motorista.cnh_verso_url ? urls[motorista.cnh_verso_url] : null}
      />
    </div>
  );
}
