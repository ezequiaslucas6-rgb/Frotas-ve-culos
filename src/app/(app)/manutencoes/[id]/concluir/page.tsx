import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClipboardCheck } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { requireSession } from '@/lib/auth';
import { toISODate } from '@/lib/dates';
import { formatPlaca } from '@/lib/validators/documentos';
import { ConcluirManutencaoForm } from './concluir-form';

export const metadata: Metadata = { title: 'Concluir manutenção' };

export default async function ConcluirManutencaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireSession();
  const { data: m } = await supabase
    .from('manutencoes')
    .select('id, veiculo_id, descricao, km_registro, situacao, checklist_id, veiculos(placa, km_atual)')
    .eq('id', id)
    .maybeSingle();
  if (!m) notFound();

  const placa = m.veiculos ? formatPlaca(m.veiculos.placa) : '';
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        title={`Concluir manutenção · ${placa}`}
        description="Registre o serviço feito e o custo. Ao concluir, o veículo é liberado."
        actions={
          m.checklist_id ? (
            <Link href={`/checklists/${m.checklist_id}`} className={buttonVariants({ variant: 'outline' })}>
              <ClipboardCheck /> Ver checklist
            </Link>
          ) : null
        }
      />
      {m.situacao === 'aberta' ? (
        <ConcluirManutencaoForm
          id={m.id}
          veiculoId={m.veiculo_id}
          descricao={m.descricao}
          km={Math.max(m.km_registro, m.veiculos?.km_atual ?? 0)}
          hoje={toISODate()}
        />
      ) : (
        <p className="rounded-xl bg-success/15 px-4 py-3 text-sm text-success-text">Esta manutenção já foi concluída.</p>
      )}
    </div>
  );
}
