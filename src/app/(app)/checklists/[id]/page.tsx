import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CircleCheck, ExternalLink, Gauge, MessageCircle, Truck, User, UserCheck } from 'lucide-react';
import { excluirChecklist } from '@/actions/checklists';
import { FotoComMarcadores, parseMarcadores } from '@/components/checklist/foto-com-marcadores';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { PageHeader } from '@/components/ui/page-header';
import { ChecklistStatusBadge, ChecklistTipoBadge } from '@/components/ui/status-badges';
import { requireSession } from '@/lib/auth';
import { agruparItens, tipoLabel, type ItemChecklist } from '@/lib/checklist/etapas';
import { carregarModelos } from '@/lib/checklist/modelos';
import { formatDateTime, formatFilial, formatKm } from '@/lib/format';
import { signedUrlMap } from '@/lib/storage';
import { formatPlaca, whatsappLink } from '@/lib/validators/documentos';

export const metadata: Metadata = { title: 'Checklist' };

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // motorista: a RLS só devolve checklists feitos em seu nome
  const { supabase, isAdmin, isMotorista } = await requireSession({ motorista: true });

  const [{ data: checklist }, { catalogo }] = await Promise.all([
    supabase
      .from('checklists')
      .select(
        '*, veiculos(id, placa, marca, modelo), motoristas(nome, whatsapp), filiais(nome_cidade, uf), profiles(nome), checklist_fotos(categoria_foto, foto_url, observacao, severidade, marcadores)',
      )
      .eq('id', id)
      .maybeSingle(),
    carregarModelos(supabase),
  ]);
  if (!checklist) notFound();

  const fotos = checklist.checklist_fotos ?? [];
  const urls = await signedUrlMap(supabase, 'checklists', fotos.map((f) => f.foto_url));
  const comProblema = fotos.filter((f) => f.severidade !== 'ok').length;

  // fotos + perguntas Sim/Não, agrupadas como no assistente (o catálogo inclui itens antigos)
  const porCodigo = new Map(catalogo.map((i) => [i.codigo, i]));
  const itemDe = (codigo: string): ItemChecklist =>
    porCodigo.get(codigo) ?? { codigo, nome: codigo, grupo: 'Outros', instrucao: null, pergunta: null, ordem: 9999, condicional: false };
  const respostas =
    checklist.respostas && typeof checklist.respostas === 'object' && !Array.isArray(checklist.respostas) ? checklist.respostas : {};
  const entradas = [
    ...fotos.map((foto) => ({ ...itemDe(foto.categoria_foto), foto, resposta: respostas[foto.categoria_foto] })),
    // "Não" na pergunta: não há foto, mas a resposta aparece no grupo
    ...Object.entries(respostas)
      .filter(([codigo, valor]) => valor === false && !fotos.some((f) => f.categoria_foto === codigo))
      .map(([codigo]) => ({ ...itemDe(codigo), foto: null, resposta: false as const })),
  ];
  const grupos = agruparItens(entradas);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Checklist ${tipoLabel(checklist.tipo).toLowerCase()} · ${checklist.veiculos ? formatPlaca(checklist.veiculos.placa) : ''}`}
        description={formatDateTime(checklist.data_envio)}
        actions={
          <>
            <ChecklistTipoBadge tipo={checklist.tipo} />
            <ChecklistStatusBadge status={checklist.status} />
            {checklist.veiculos ? (
              <Link href={isMotorista ? '/meu-veiculo' : `/veiculos/${checklist.veiculos.id}`} className={buttonVariants({ variant: 'outline' })}>
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

      {grupos.map((g) => (
        <section key={g.grupo} className="flex flex-col gap-3" aria-labelledby={`grupo-${g.grupo}`}>
          <h2 id={`grupo-${g.grupo}`} className="flex items-center gap-2 text-lg font-semibold">
            {g.grupo}
            <span className="text-sm font-normal text-muted-foreground">
              {g.itens.filter((i) => i.foto).length} foto(s)
            </span>
          </h2>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {g.itens.map((item) => {
              const foto = item.foto;
              const url = foto ? urls[foto.foto_url] : undefined;
              return (
                <li key={item.codigo}>
                  <Card className="h-full gap-3 py-4">
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{item.nome}</p>
                        {foto ? <ChecklistStatusBadge status={foto.severidade} /> : null}
                      </div>
                      {item.pergunta && typeof item.resposta === 'boolean' ? (
                        <p className="text-sm">
                          <span className="text-muted-foreground">{item.pergunta}</span>{' '}
                          <span className={item.resposta ? 'font-semibold text-destructive-text' : 'font-semibold text-success-text'}>
                            {item.resposta ? 'Sim' : 'Não'}
                          </span>
                        </p>
                      ) : null}
                      {foto && url ? (
                        <>
                          <FotoComMarcadores src={url} alt={item.nome} marcadores={parseMarcadores(foto.marcadores)} />
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline">
                            Abrir original <ExternalLink className="size-3" />
                          </a>
                        </>
                      ) : foto ? (
                        <p className="text-sm text-muted-foreground">Foto indisponível.</p>
                      ) : (
                        <p className="flex items-center gap-1.5 text-sm text-success-text">
                          <CircleCheck className="size-4" /> Sem vazamento ou avaria.
                        </p>
                      )}
                      {foto?.observacao ? <p className="rounded-lg bg-muted px-3 py-2 text-sm">{foto.observacao}</p> : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
