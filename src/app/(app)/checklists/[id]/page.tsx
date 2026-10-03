import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, Gauge, MessageCircle, Truck, User, UserCheck } from 'lucide-react';
import { excluirChecklist } from '@/actions/checklists';
import { FotoComMarcadores, parseMarcadores } from '@/components/checklist/foto-com-marcadores';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { PageHeader } from '@/components/ui/page-header';
import { ChecklistStatusBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { CHECKLIST_ETAPAS } from '@/lib/checklist/etapas';
import { formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { signedUrlMap } from '@/lib/storage';
import { formatPlaca, whatsappLink } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Checklist' };

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, isAdmin } = await requireSession();

  const { data: checklist } = await supabase
    .from('checklists')
    .select(
      '*, veiculos(id, placa, marca, modelo), motoristas(nome, whatsapp), filiais(nome_cidade, uf), profiles(nome), checklist_fotos(categoria_foto, foto_url, observacao, severidade, marcadores)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!checklist) notFound();

  const fotos = checklist.checklist_fotos ?? [];
  const urls = await signedUrlMap(supabase, 'checklists', fotos.map((f) => f.foto_url));
  const porCategoria = new Map(fotos.map((f) => [f.categoria_foto, f]));
  const comProblema = fotos.filter((f) => f.severidade !== 'ok').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Checklist · ${checklist.veiculos ? formatPlaca(checklist.veiculos.placa) : ''}`}
        description={formatDateTime(checklist.data_envio)}
        actions={
          <>
            <ChecklistStatusBadge status={checklist.status} />
            {checklist.veiculos ? (
              <Link href={`/veiculos/${checklist.veiculos.id}`} className={buttonVariants({ variant: 'outline' })}>
                <Truck /> Ver veículo
              </Link>
            ) : null}
            {isAdmin ? (
              <DeleteButton action={excluirChecklist} id={checklist.id} confirmMessage="Excluir este checklist e todas as suas fotos?" />
            ) : null}
          </>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="flex items-center gap-1 text-muted-foreground">
              <User className="size-4" /> Motorista
            </p>
            <p className="font-medium">{checklist.motoristas?.nome ?? '—'}</p>
            {checklist.motoristas ? (
              <a
                href={whatsappLink(checklist.motoristas.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-success-text hover:underline"
              >
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
            ) : null}
          </div>
          <div>
            <p className="flex items-center gap-1 text-muted-foreground">
              <UserCheck className="size-4" /> Registrado por
            </p>
            <p className="font-medium">{checklist.profiles?.nome ?? '—'}</p>
            {checklist.filiais ? <p className="text-xs text-muted-foreground">{formatFilial(checklist.filiais)}</p> : null}
          </div>
          <div>
            <p className="flex items-center gap-1 text-muted-foreground">
              <Gauge className="size-4" /> KM
            </p>
            <p className="font-medium">{checklist.km_registro != null ? formatKm(checklist.km_registro) : '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Itens com inconformidade</p>
            <p className="font-medium">
              {comProblema} de {fotos.length}
            </p>
          </div>
          {checklist.observacoes_gerais ? (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-muted-foreground">Observações gerais</p>
              <p className="whitespace-pre-line">{checklist.observacoes_gerais}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CHECKLIST_ETAPAS.map((etapa, i) => {
          const foto = porCategoria.get(etapa.categoria);
          const url = foto ? urls[foto.foto_url] : undefined;
          return (
            <li key={etapa.categoria}>
              <Card className="h-full gap-3 py-4">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">
                      {i + 1}. {etapa.titulo}
                    </p>
                    {foto ? <ChecklistStatusBadge status={foto.severidade} /> : null}
                  </div>
                  {foto && url ? (
                    <>
                      <FotoComMarcadores src={url} alt={etapa.titulo} marcadores={parseMarcadores(foto.marcadores)} />
                      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline">
                        Abrir original <ExternalLink className="size-3" />
                      </a>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Foto indisponível.</p>
                  )}
                  {foto?.observacao ? (
                    <p className="rounded-lg bg-muted px-3 py-2 text-sm">{foto.observacao}</p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
