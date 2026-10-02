import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, Pencil } from 'lucide-react';
import { excluirFilial } from '@/actions/filiais';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { requireAdmin } from '@/lib/auth';
import { FilialForm } from './filial-form';

export const metadata: Metadata = { title: 'Filiais' };

export default async function FiliaisPage() {
  const { supabase } = await requireAdmin();
  const [{ data: filiais }, { data: veiculos }] = await Promise.all([
    supabase.from('filiais').select('*').order('nome_cidade'),
    supabase.from('veiculos').select('filial_id'),
  ]);
  const totalPorFilial = new Map<string, number>();
  for (const v of veiculos ?? []) totalPorFilial.set(v.filial_id, (totalPorFilial.get(v.filial_id) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Filiais" description="Cidades/unidades da operação. Cada supervisor é vinculado a uma única filial." />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {(filiais ?? []).length === 0 ? (
            <EmptyState icon={<Building2 />} title="Nenhuma filial cadastrada" description="Adicione a primeira filial ao lado." />
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
              {(filiais ?? []).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">
                      {f.nome_cidade}/{f.uf}
                    </p>
                    <p className="text-xs text-muted-foreground">{totalPorFilial.get(f.id) ?? 0} veículo(s)</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link href={`/filiais/${f.id}/editar`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                      <Pencil /> Editar
                    </Link>
                    <DeleteButton
                      action={excluirFilial}
                      id={f.id}
                      confirmMessage={`Excluir a filial ${f.nome_cidade}/${f.uf}?`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nova filial</CardTitle>
          </CardHeader>
          <CardContent>
            <FilialForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
