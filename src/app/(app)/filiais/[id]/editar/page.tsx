import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireAdmin } from '@/lib/auth';
import { FilialForm } from '../../filial-form';

export const metadata: Metadata = { title: 'Editar filial' };

export default async function EditarFilialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const { data: filial } = await supabase.from('filiais').select('*').eq('id', id).maybeSingle();
  if (!filial) notFound();
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <PageHeader title={`Editar ${filial.nome_cidade}/${filial.uf}`} />
      <Card>
        <CardContent>
          <FilialForm filial={filial} />
        </CardContent>
      </Card>
    </div>
  );
}
