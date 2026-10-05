import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { requireAdmin } from '@/lib/auth';
import { TIPOS_CHECKLIST, agruparItens } from '@/lib/checklist/etapas';
import { carregarModelos } from '@/lib/checklist/modelos';
import { ModelosForm } from './modelos-form';

export const metadata: Metadata = { title: 'Modelos de checklist' };

export default async function ModelosChecklistPage() {
  const { supabase } = await requireAdmin();
  const { ativos, modelos } = await carregarModelos(supabase);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Modelos de checklist"
        description="Marque as fotos que cada tipo exige. Vale para os próximos checklists; os já enviados não mudam."
        actions={
          <Link href="/checklists" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft /> Checklists
          </Link>
        }
      />
      <ModelosForm
        grupos={agruparItens(ativos)}
        inicial={Object.fromEntries(TIPOS_CHECKLIST.map((t) => [t.value, modelos[t.value].map((i) => i.codigo)]))}
      />
    </div>
  );
}
