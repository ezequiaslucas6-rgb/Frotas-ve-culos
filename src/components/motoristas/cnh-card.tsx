import { FileText, IdCard, ImageOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CnhBadge } from '@/components/ui/status-badges';
import { formatDateISO } from '@/lib/format';
import { situacaoCnh } from '@/lib/motoristas/cnh';
import { cn } from '@/lib/utils';
import type { Tables } from '@/types/database';

type DadosCnh = Pick<
  Tables<'motoristas'>,
  | 'cnh'
  | 'cnh_categoria'
  | 'cnh_validade'
  | 'cnh_emissao'
  | 'cnh_primeira_habilitacao'
  | 'cnh_uf'
  | 'cnh_ear'
  | 'cnh_observacoes'
  | 'cnh_frente_url'
  | 'cnh_verso_url'
>;

/** Miniatura da CNH: abre o arquivo (URL assinada) em outra aba. PDFs viram um ícone. */
function Arquivo({ titulo, path, url }: { titulo: string; path: string | null; url: string | null | undefined }) {
  const pdf = path?.toLowerCase().endsWith('.pdf');
  const conteudo = !path ? (
    <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
      <ImageOff className="size-6" />
      Sem imagem
    </span>
  ) : pdf || !url ? (
    <span className="flex flex-col items-center gap-1 text-xs font-medium text-muted-foreground">
      <FileText className="size-7 text-icone" />
      Abrir PDF
    </span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={`CNH — ${titulo}`} className="size-full object-cover" />
  );
  const classes = 'flex aspect-[1.55] items-center justify-center overflow-hidden rounded-xl bg-raised';
  return (
    <figure className="flex flex-col gap-1.5">
      {path && url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={cn(classes, 'transition-opacity hover:opacity-85')}>
          {conteudo}
        </a>
      ) : (
        <div className={classes}>{conteudo}</div>
      )}
      <figcaption className="text-xs text-muted-foreground">{titulo}</figcaption>
    </figure>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-semibold">{valor}</dd>
    </div>
  );
}

export function CnhCard({
  motorista,
  urls,
  hoje,
  className,
}: {
  motorista: DadosCnh;
  urls: Record<string, string>;
  hoje: string;
  className?: string;
}) {
  const situacao = situacaoCnh(motorista.cnh_validade, hoje);
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <IdCard className="size-4 text-icone" /> CNH
        </CardTitle>
        <CnhBadge situacao={situacao} detalhe />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Dado rotulo="Nº de registro" valor={<span className="font-mono">{motorista.cnh}</span>} />
          <Dado rotulo="Categoria" valor={motorista.cnh_categoria ?? '—'} />
          <Dado rotulo="Validade" valor={formatDateISO(motorista.cnh_validade)} />
          <Dado rotulo="Emissão" valor={formatDateISO(motorista.cnh_emissao)} />
          <Dado rotulo="1ª habilitação" valor={formatDateISO(motorista.cnh_primeira_habilitacao)} />
          <Dado rotulo="UF" valor={motorista.cnh_uf ?? '—'} />
          <Dado rotulo="EAR (atividade remunerada)" valor={motorista.cnh_ear ? 'Sim' : 'Não'} />
          {motorista.cnh_observacoes ? (
            <div className="col-span-2 sm:col-span-3">
              <Dado rotulo="Observações" valor={<span className="font-normal">{motorista.cnh_observacoes}</span>} />
            </div>
          ) : null}
        </dl>
        <div className="grid grid-cols-2 gap-3">
          <Arquivo
            titulo="Frente"
            path={motorista.cnh_frente_url}
            url={motorista.cnh_frente_url ? urls[motorista.cnh_frente_url] : null}
          />
          <Arquivo
            titulo="Verso"
            path={motorista.cnh_verso_url}
            url={motorista.cnh_verso_url ? urls[motorista.cnh_verso_url] : null}
          />
        </div>
      </CardContent>
    </Card>
  );
}
