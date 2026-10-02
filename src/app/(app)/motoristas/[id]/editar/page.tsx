import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireSession } from '@/lib/auth';
import { MotoristaForm } from '../../motorista-form';

export const metadata: Metadata = { title: 'Editar motorista' };

export default async function EditarMotoristaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireSession();
  const { data: motorista } = await supabase.from('motoristas').select('*').eq('id', id).maybeSingle();
  if (!motorista) notFound();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={`Editar ${motorista.nome}`} />
      <MotoristaForm filiais={null} motorista={motorista} />
    </div>
  );
}
