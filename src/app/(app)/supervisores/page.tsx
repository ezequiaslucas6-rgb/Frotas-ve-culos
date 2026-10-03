import type { Metadata } from 'next';
import { UserCog } from 'lucide-react';
import { excluirSupervisor } from '@/actions/supervisores';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { requireAdmin } from '@/lib/auth';
import { formatFilial } from '@/lib/format';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupervisorForm } from './supervisor-form';

export const metadata: Metadata = { title: 'Supervisores' };

export default async function SupervisoresPage() {
  const { supabase, user } = await requireAdmin();
  const [{ data: perfis }, { data: filiais }, { data: authUsers }] = await Promise.all([
    // motoristas têm o próprio acesso, gerenciado no cadastro de cada um
    supabase.from('profiles').select('id, nome, role, filial_id, filiais(nome_cidade, uf)').neq('role', 'motorista').order('nome'),
    supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade'),
    // e-mails vivem em auth.users (não em profiles): consulta com a service role, só no servidor
    createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const emails = new Map<string, string>();
  for (const u of authUsers?.users ?? []) if (u.email) emails.set(u.id, u.email);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Supervisores" description="Usuários com acesso restrito à filial a que estão vinculados." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {(perfis ?? []).length === 0 ? (
            <EmptyState icon={<UserCog />} title="Nenhum usuário" />
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
              {(perfis ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">{emails.get(p.id) ?? '—'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.role === 'admin' ? (
                      <Badge>Administrador Geral</Badge>
                    ) : (
                      <Badge variant="secondary">{p.filiais ? formatFilial(p.filiais) : 'Sem filial'}</Badge>
                    )}
                    {p.role === 'supervisor' && p.id !== user.id ? (
                      <DeleteButton
                        action={excluirSupervisor}
                        id={p.id}
                        confirmMessage={`Excluir o supervisor ${p.nome}? Ele perderá o acesso imediatamente.`}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Novo supervisor</CardTitle>
          </CardHeader>
          <CardContent>
            {(filiais ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Cadastre uma filial antes de criar supervisores.</p>
            ) : (
              <SupervisorForm filiais={filiais ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
