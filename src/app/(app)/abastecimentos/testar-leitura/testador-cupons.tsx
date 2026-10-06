'use client';

import { useRef, useState } from 'react';
import { Copy, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { testarLeituraCupom, type ResultadoLeituraCupom } from '@/actions/cupom';
import { LeituraCupom } from '@/components/abastecimentos/leitura-cupom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { combustivelLabel, type Combustivel } from '@/lib/abastecimento/consumo';
import { formatBytes } from '@/lib/image/compress';
import { digitalizarCupom } from '@/lib/image/digitalizar';
import { createClient } from '@/lib/supabase/client';
import { uuid } from '@/lib/uuid';

interface Teste {
  id: string;
  nome: string;
  preview: string | null;
  tamanho: string | null;
  estado: 'digitalizando' | 'lendo' | 'pronto';
  resultado?: ResultadoLeituraCupom;
}

/** Lê vários modelos de cupom em sequência, mostrando o que a IA entendeu de cada um. */
export function TestadorCupons({ modelos }: { modelos: string[] }) {
  const [testes, setTestes] = useState<Teste[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const atualizar = (id: string, dados: Partial<Teste>) => setTestes((lista) => lista.map((t) => (t.id === id ? { ...t, ...dados } : t)));

  async function testar(arquivos: File[]) {
    setOcupado(true);
    const novos = arquivos.map((f) => ({ id: uuid(), nome: f.name, preview: null, tamanho: null, estado: 'digitalizando' as const }));
    setTestes((lista) => [...novos, ...lista]);
    const storage = createClient().storage.from('abastecimentos');
    // um de cada vez: respeita o limite por minuto do plano gratuito
    for (const [i, arquivo] of arquivos.entries()) {
      const { id } = novos[i]!;
      try {
        const { blob, originalSize } = await digitalizarCupom(arquivo);
        atualizar(id, { preview: URL.createObjectURL(blob), tamanho: `${formatBytes(originalSize)} → ${formatBytes(blob.size)}`, estado: 'lendo' });
        const caminho = `testes-leitura/${uuid()}.jpg`;
        const { error } = await storage.upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
        const resultado: ResultadoLeituraCupom = error
          ? { ok: false, codigo: 'envio', mensagem: 'Falha ao enviar a foto. Verifique a conexão.' }
          : await testarLeituraCupom(caminho);
        atualizar(id, { estado: 'pronto', resultado });
      } catch {
        atualizar(id, { estado: 'pronto', resultado: { ok: false, codigo: 'falha', mensagem: 'Não foi possível processar esta foto.' } });
      }
    }
    setOcupado(false);
  }

  const copiar = async () => {
    const dados = testes
      .filter((t) => t.resultado)
      .map((t) => ({ arquivo: t.nome, ...(t.resultado!.ok ? { leitura: t.resultado!.registro, calculo: t.resultado!.calculo } : { erro: t.resultado!.mensagem }) }));
    try {
      await navigator.clipboard.writeText(JSON.stringify(dados, null, 2));
      toast.success('Resultados copiados.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Fotos dos modelos de nota</p>
            <p className="text-muted-foreground">
              Pode escolher várias de uma vez. Cada foto passa pela digitalização e pela leitura, como no lançamento. Modelos: {modelos.join(', ')}.
            </p>
          </div>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              const arquivos = [...(e.target.files ?? [])];
              e.target.value = '';
              if (arquivos.length) void testar(arquivos);
            }}
          />
          <Button type="button" disabled={ocupado} onClick={() => input.current?.click()}>
            {ocupado ? <Loader2 className="animate-spin" /> : <ImagePlus />} {ocupado ? 'Lendo…' : 'Escolher fotos'}
          </Button>
          {testes.some((t) => t.resultado) ? (
            <Button type="button" variant="outline" onClick={copiar}>
              <Copy /> Copiar resultados
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {testes.map((t) => {
        const r = t.resultado;
        const l = r?.ok ? r.registro.leitura : null;
        return (
          <Card key={t.id}>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <div className="flex flex-col gap-1.5">
                {t.preview ? (
                  <a href={t.preview} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.preview} alt={`Cupom ${t.nome}`} className="max-h-80 w-full object-contain" />
                  </a>
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg bg-muted">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                <p className="truncate text-xs text-muted-foreground" title={t.nome}>
                  {t.nome}
                  {t.tamanho ? ` · ${t.tamanho}` : ''}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                {t.estado !== 'pronto' || !r ? (
                  <LeituraCupom estado={{ fase: 'lendo' }} unidade="L" onTentarDeNovo={() => undefined} />
                ) : r.ok ? (
                  <LeituraCupom
                    estado={{ fase: 'pronta', calculo: r.calculo, preenchidos: [], nota: `Lido por ${r.registro.modelo}.` }}
                    unidade={l?.combustivel === 'gnv' ? 'm³' : 'L'}
                    onTentarDeNovo={() => undefined}
                  />
                ) : (
                  <LeituraCupom estado={{ fase: 'erro', mensagem: r.mensagem, podeTentar: false }} unidade="L" onTentarDeNovo={() => undefined} />
                )}
                {l ? (
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    {(
                      [
                        ['Produto', l.produto],
                        ['Combustível', l.combustivel && l.combustivel !== 'outro' ? combustivelLabel(l.combustivel as Combustivel) : l.combustivel],
                        ['Data', l.data?.split('-').reverse().join('/')],
                        ['Posto', l.posto],
                        ['CNPJ', l.cnpj],
                        ['Placa / KM', [l.placa, l.km].filter(Boolean).join(' · ') || null],
                      ] as const
                    ).map(([rotulo, valor]) => (
                      <div key={rotulo} className="flex min-w-0 gap-2">
                        <dt className="shrink-0 text-muted-foreground">{rotulo}:</dt>
                        <dd className="truncate">{valor ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
