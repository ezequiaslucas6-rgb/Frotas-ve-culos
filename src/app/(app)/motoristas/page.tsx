import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { excluirMotorista } from '@/actions/motoristas';
import { FilialFilter } from '@/components/filial-filter';
import { Pagination } from '@/components/pagination';
import { Button, buttonVariants } from '@/components/ui/button';
import { DeleteButton } from '@/components/ui/delete-button';
import { Input } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { MotoristaStatusBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { formatFilial } from '@/lib/format';
import { pageRange, parsePage, resolveFilialFilter, sanitizeSearch, type SearchParams } from '@/lib/pagination';
import { formatCpf, formatWhatsapp, whatsappLink } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Motoristas' };

export default async function MotoristasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { supabase, isAdmin } = session;
  const filialId = resolveFilialFilter(session, sp);
  const q = sanitizeSearch(sp.q);
  const page = parsePage(sp.page);
  const { from, to } = pageRange(page);

  let query = supabase
    .from('motoristas')
    .select('*, filiais(nome_cidade, uf)', { count: 'exact' })
    .order('nome')
    .range(from, to);
  if (filialId) query = query.eq('filial_id', filialId);
  if (q) query = query.or(`nome.ilike.%${q}%,email.ilike.%${q}%,cpf.ilike.%${q.replace(/\D/g, '') || q}%`);

  const [{ data: motoristas, count }, { data: filiais }] = await Promise.all([
    query,
    isAdmin ? supabase.from('filiais').select('id, nome_cidade, uf').order('nome_cidade') : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Motoristas"
        description={`${count ?? 0} motorista(s)`}
        actions={
          <Link href="/motoristas/novo" className={buttonVariants()}>
            <Plus /> Novo motorista
          </Link>
        }
      />

      <form className="flex flex-col gap-2 sm:flex-row" role="search">
        {filialId && isAdmin ? <input type="hidden" name="filial" value={filialId} /> : null}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Buscar por nome, e-mail ou CPF" className="pl-9" aria-label="Buscar motoristas" />
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
        {isAdmin ? <FilialFilter filiais={filiais ?? []} /> : null}
      </form>

      {(motoristas ?? []).length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nenhum motorista encontrado"
          description={q ? 'Tente outro termo de busca.' : 'Cadastre os motoristas da filial para vinculá-los aos checklists.'}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {(motoristas ?? []).map((m) => (
            <li key={m.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{m.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    CPF {formatCpf(m.cpf)} · CNH {m.cnh}
                    {isAdmin && m.filiais ? ` · ${formatFilial(m.filiais)}` : ''}
                  </p>
                </div>
                <MotoristaStatusBadge status={m.status} />
              </div>
              <p className="truncate text-sm text-muted-foreground">{m.email}</p>
              <div className="flex flex-wrap items-center gap-2">
                {/* Contato rápido: abre a conversa no WhatsApp (app nativo no celular, Web no desktop) */}
                <a
                  href={whatsappLink(m.whatsapp, `Olá ${m.nome.split(' ')[0]}, tudo bem?`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Chamar ${m.nome} no WhatsApp`}
                  className={buttonVariants({ variant: 'success', size: 'sm' })}
                >
                  <MessageCircle /> {formatWhatsapp(m.whatsapp)}
                </a>
                <span className="flex-1" />
                <Link href={`/motoristas/${m.id}/editar`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  <Pencil /> Editar
                </Link>
                {isAdmin ? (
                  <DeleteButton
                    action={excluirMotorista}
                    id={m.id}
                    confirmMessage={`Excluir o motorista ${m.nome}? Esta ação não pode ser desfeita.`}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination basePath="/motoristas" searchParams={sp} page={page} total={count ?? 0} />
    </div>
  );
}
