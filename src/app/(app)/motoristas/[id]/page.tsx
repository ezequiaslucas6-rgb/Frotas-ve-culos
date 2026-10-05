import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mail, MessageCircle, Pencil, Smartphone, Truck } from 'lucide-react';
import { ListaAbastecimentos } from '@/components/abastecimentos/lista-abastecimentos';
import { CnhCard } from '@/components/motoristas/cnh-card';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { MotoristaStatusBadge } from '@/components/ui/status-badges';
import { calcularConsumo, detectarConsumoAnormal } from '@/lib/abastecimento/consumo';
import { requireSession } from '@/lib/auth';
import { toISODate } from '@/lib/dates';
import { formatFilial, formatKm } from '@/lib/format';
import { signedUrlMap } from '@/lib/storage';
import { formatCpf, formatPlaca, formatWhatsapp, whatsappLink } from '@/lib/validators/documentos';
import { AcessoApp } from './acesso-app';

export const metadata: Metadata = { title: 'Motorista' };

export default async function MotoristaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireSession();

  // tudo em paralelo (só depende do id); as URLs das imagens saem numa segunda leva, também em paralelo
  const [{ data: m }, { data: veiculos }, { data: abastecimentos }] = await Promise.all([
    supabase.from('motoristas').select('*, filiais(nome_cidade, uf)').eq('id', id).maybeSingle(),
    supabase.from('veiculos').select('id, placa, marca, modelo, km_atual').eq('motorista_id', id).order('placa'),
    supabase
      .from('abastecimentos')
      .select('id, veiculo_id, data_abastecimento, km, litros, valor_total, preco_litro, combustivel, tanque_cheio, posto, comprovante_url, veiculos(placa)')
      .eq('motorista_id', id)
      .order('data_abastecimento', { ascending: false })
      .order('km', { ascending: false })
      .limit(10),
  ]);
  if (!m) notFound();
  const [urlsCnh, urlsCupom] = await Promise.all([
    signedUrlMap(supabase, 'motoristas', [m.cnh_frente_url, m.cnh_verso_url]),
    signedUrlMap(supabase, 'abastecimentos', (abastecimentos ?? []).map((a) => a.comprovante_url)),
  ]);
  const porVeiculo = Map.groupBy(abastecimentos ?? [], (a) => a.veiculo_id);
  const consumo = Object.assign({}, ...[...porVeiculo.values()].map((lista) => calcularConsumo(lista).porLancamento));
  const anomalias = Object.assign({}, ...[...porVeiculo.values()].map((lista) => detectarConsumoAnormal(lista).porLancamento));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={m.nome}
        description={`CPF ${formatCpf(m.cpf)}${m.filiais ? ` · ${formatFilial(m.filiais)}` : ''}`}
        actions={
          <>
            <a
              href={whatsappLink(m.whatsapp, `Olá ${m.nome.split(' ')[0]}, tudo bem?`)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'success' })}
            >
              <MessageCircle /> {formatWhatsapp(m.whatsapp)}
            </a>
            <Link href={`/motoristas/${m.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil /> Editar
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <CnhCard motorista={m} urls={urlsCnh} hoje={toISODate()} />

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="size-4 text-icone" /> Acesso ao app
              </CardTitle>
              <MotoristaStatusBadge status={m.status} />
            </CardHeader>
            <CardContent>
              <AcessoApp motoristaId={m.id} email={m.email} temAcesso={Boolean(m.user_id)} inativo={m.status === 'inativo'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4 text-icone" /> Veículos sob responsabilidade
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(veiculos ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum veículo. Defina o motorista responsável na edição do veículo.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {(veiculos ?? []).map((v) => (
                    <li key={v.id}>
                      <Link href={`/veiculos/${v.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                        <span className="min-w-0">
                          <span className="font-semibold">{formatPlaca(v.placa)}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[v.marca, v.modelo].filter(Boolean).join(' ') || 'Sem modelo'}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">{formatKm(v.km_atual)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-4" /> {m.email}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Últimos abastecimentos</CardTitle>
          <Link href={`/abastecimentos?motorista=${m.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {(abastecimentos ?? []).length === 0 ? (
            <EmptyState title="Nenhum abastecimento lançado" />
          ) : (
            <ListaAbastecimentos itens={abastecimentos ?? []} consumo={consumo} anomalias={anomalias} urls={urlsCupom} mostrarVeiculo />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
