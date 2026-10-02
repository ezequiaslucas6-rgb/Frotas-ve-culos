'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleCheck, Loader2, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { salvarChecklist } from '@/actions/checklists';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { ChecklistStatusBadge } from '@/components/ui/status-badges';
import {
  CHECKLIST_ETAPAS,
  SEVERIDADE_LABEL,
  TOTAL_ETAPAS,
  calcularStatusChecklist,
  caminhoFotoChecklist,
  contarSeveridades,
  type CategoriaFoto,
} from '@/lib/checklist/etapas';
import { compressImage, formatBytes } from '@/lib/image/compress';
import { createClient } from '@/lib/supabase/client';
import { uuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import { clearDraft, parseDraft, readDraftRaw, saveDraft, subscribeDraft } from './draft';
import { EtapaCaptura } from './etapa-captura';
import type { ChecklistDraft, EtapasState, EtapaState, MotoristaWizard, VeiculoWizard } from './types';

const PASSO_IDENTIFICACAO = 0;
const PASSO_REVISAO = TOTAL_ETAPAS + 1;
const UPLOAD_TENTATIVAS = 3;

const etapaVazia = (): EtapaState => ({
  fase: 'vazia',
  fotoPath: null,
  previewUrl: null,
  severidade: 'ok',
  observacao: '',
  marcadores: [],
});

const etapasIniciais = (): EtapasState =>
  Object.fromEntries(CHECKLIST_ETAPAS.map((e) => [e.categoria, etapaVazia()])) as EtapasState;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SEVERIDADE_BAR: Record<EtapaState['severidade'], string> = {
  ok: 'bg-success',
  atencao: 'bg-warning',
  critico: 'bg-destructive',
};

interface ChecklistWizardProps {
  userId: string;
  veiculos: VeiculoWizard[];
  motoristas: MotoristaWizard[];
  veiculoInicialId?: string;
}

export function ChecklistWizard({ userId, veiculos, motoristas, veiculoInicialId }: ChecklistWizardProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [passo, setPasso] = useState(PASSO_IDENTIFICACAO);
  // O id é gerado no cliente: as fotos sobem para <filial>/<checklistId>/ ANTES do envio final.
  const [checklistId, setChecklistId] = useState(uuid);
  const [veiculoId, setVeiculoId] = useState(veiculos.some((v) => v.id === veiculoInicialId) ? (veiculoInicialId ?? '') : '');
  const [motoristaId, setMotoristaId] = useState('');
  const [kmAtual, setKmAtual] = useState('');
  const [observacoesGerais, setObservacoesGerais] = useState('');
  const [etapas, setEtapas] = useState<EtapasState>(etapasIniciais);
  const [decisaoRascunho, setDecisaoRascunho] = useState<'pendente' | 'resolvida'>('pendente');
  const [restaurando, setRestaurando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviando, startEnviar] = useTransition();

  const etapasRef = useRef(etapas);
  const blobs = useRef<Partial<Record<CategoriaFoto, Blob>>>({});
  useEffect(() => {
    etapasRef.current = etapas;
  });

  const veiculo = veiculos.find((v) => v.id === veiculoId) ?? null;
  const motoristasDaFilial = useMemo(
    () => motoristas.filter((m) => m.filial_id === veiculo?.filial_id),
    [motoristas, veiculo?.filial_id],
  );

  /* ------------------------------ rascunho ------------------------------ */

  // localStorage é um sistema externo: lido via useSyncExternalStore (snapshot do servidor = sem rascunho)
  const rascunhoBruto = useSyncExternalStore(
    subscribeDraft,
    () => readDraftRaw(userId),
    () => null,
  );
  const rascunhoSalvo = useMemo(() => {
    const d = parseDraft(rascunhoBruto);
    return d && veiculos.some((v) => v.id === d.veiculoId) && Object.keys(d.etapas).length > 0 ? d : null;
  }, [rascunhoBruto, veiculos]);
  // enquanto o usuário não decide (continuar/descartar), o rascunho antigo NÃO pode ser sobrescrito
  const rascunho = decisaoRascunho === 'pendente' ? rascunhoSalvo : null;

  useEffect(() => {
    if (rascunhoBruto && !parseDraft(rascunhoBruto)) clearDraft(userId); // expirado/corrompido
  }, [rascunhoBruto, userId]);

  // persiste (com debounce) enquanto não houver decisão pendente sobre um rascunho antigo
  useEffect(() => {
    if (rascunho || !veiculoId || concluido) return;
    const timer = setTimeout(() => {
      const salvas: ChecklistDraft['etapas'] = {};
      for (const e of CHECKLIST_ETAPAS) {
        const s = etapas[e.categoria];
        if (s.fase === 'enviada' && s.fotoPath) {
          salvas[e.categoria] = { fotoPath: s.fotoPath, severidade: s.severidade, observacao: s.observacao, marcadores: s.marcadores };
        }
      }
      saveDraft(userId, { checklistId, veiculoId, motoristaId, kmAtual, observacoesGerais, passo, etapas: salvas, savedAt: Date.now() });
      // a partir daqui o rascunho no storage é o PRÓPRIO progresso desta sessão, nunca um "rascunho antigo pendente"
      setDecisaoRascunho('resolvida');
    }, 300);
    return () => clearTimeout(timer);
  }, [rascunho, concluido, userId, checklistId, veiculoId, motoristaId, kmAtual, observacoesGerais, passo, etapas]);

  async function restaurarRascunho(d: ChecklistDraft) {
    setRestaurando(true);
    const caminhos = Object.values(d.etapas).map((e) => e.fotoPath);
    const { data } = await supabase.storage.from('checklists').createSignedUrls(caminhos, 3600);
    const urls = new Map((data ?? []).filter((i) => i.signedUrl && i.path).map((i) => [i.path as string, i.signedUrl]));

    const restauradas = etapasIniciais();
    for (const e of CHECKLIST_ETAPAS) {
      const salva = d.etapas[e.categoria];
      const url = salva ? urls.get(salva.fotoPath) : undefined;
      // foto que não está mais no Storage volta a ser "vazia" (precisa ser refeita)
      if (salva && url) {
        restauradas[e.categoria] = { ...etapaVazia(), ...salva, fase: 'enviada', previewUrl: url };
      }
    }
    setChecklistId(d.checklistId);
    setVeiculoId(d.veiculoId);
    setMotoristaId(d.motoristaId);
    setKmAtual(d.kmAtual);
    setObservacoesGerais(d.observacoesGerais);
    setEtapas(restauradas);
    setPasso(d.passo);
    setDecisaoRascunho('resolvida');
    setRestaurando(false);
    toast.success('Checklist em andamento restaurado.');
  }

  function descartarRascunho() {
    clearDraft(userId);
    setDecisaoRascunho('resolvida');
  }

  /* ------------------------------ fotos ------------------------------ */

  const patchEtapa = useCallback((categoria: CategoriaFoto, patch: Partial<EtapaState>) => {
    setEtapas((prev) => ({ ...prev, [categoria]: { ...prev[categoria], ...patch } }));
  }, []);

  async function enviarFoto(categoria: CategoriaFoto) {
    const blob = blobs.current[categoria];
    if (!blob || !veiculo) return;
    const path = caminhoFotoChecklist(veiculo.filial_id, checklistId, categoria);
    patchEtapa(categoria, { fase: 'enviando', erro: undefined });

    for (let tentativa = 1; tentativa <= UPLOAD_TENTATIVAS; tentativa++) {
      const { error } = await supabase.storage
        .from('checklists')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (!error) {
        patchEtapa(categoria, { fase: 'enviada', fotoPath: path, erro: undefined });
        return;
      }
      if (tentativa < UPLOAD_TENTATIVAS) await sleep(tentativa * 1000);
    }
    patchEtapa(categoria, { fase: 'erro', erro: 'Não foi possível enviar a foto. Verifique a conexão e tente novamente.' });
  }

  async function processarFoto(categoria: CategoriaFoto, file: File) {
    if (!veiculo) return;
    patchEtapa(categoria, { fase: 'processando', erro: undefined });
    try {
      const comprimida = await compressImage(file, { maxDimension: 1600, quality: 0.8 });
      blobs.current[categoria] = comprimida.blob;
      const anterior = etapasRef.current[categoria].previewUrl;
      if (anterior?.startsWith('blob:')) URL.revokeObjectURL(anterior);
      patchEtapa(categoria, {
        previewUrl: URL.createObjectURL(comprimida.blob),
        tamanho: `${formatBytes(comprimida.originalSize)} → ${formatBytes(comprimida.blob.size)}`,
        fotoPath: null,
      });
      await enviarFoto(categoria);
    } catch {
      patchEtapa(categoria, {
        fase: etapasRef.current[categoria].previewUrl ? 'erro' : 'vazia',
        erro: 'Não foi possível processar esta imagem. Tire outra foto.',
      });
    }
  }

  // blobs locais são liberados ao sair
  useEffect(
    () => () => {
      for (const e of Object.values(etapasRef.current)) if (e.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(e.previewUrl);
    },
    [],
  );

  // aviso ao tentar fechar com upload em andamento
  const algumOcupado = Object.values(etapas).some((e) => e.fase === 'processando' || e.fase === 'enviando');
  useEffect(() => {
    if (!algumOcupado) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [algumOcupado]);

  /* ------------------------------ validação ------------------------------ */

  const kmNumero = Number(kmAtual);
  const kmValido = kmAtual.trim() !== '' && Number.isInteger(kmNumero) && kmNumero >= (veiculo?.km_atual ?? 0);

  const etapaValida = (categoria: CategoriaFoto) => {
    const e = etapas[categoria];
    const base = e.fase === 'enviada' && (e.severidade === 'ok' || e.observacao.trim().length > 0);
    return categoria === 'painel' ? base && kmValido : base;
  };

  const identificacaoValida = Boolean(veiculo && motoristaId);
  const validas = CHECKLIST_ETAPAS.map((e) => etapaValida(e.categoria));
  const primeiroPendente = validas.indexOf(false); // -1 => tudo pronto
  const todasValidas = primeiroPendente === -1;
  const passoMaximo = !identificacaoValida ? PASSO_IDENTIFICACAO : todasValidas ? PASSO_REVISAO : primeiroPendente + 1;

  const etapaAtual = passo >= 1 && passo <= TOTAL_ETAPAS ? CHECKLIST_ETAPAS[passo - 1] : null;
  const podeAvancar = passo === PASSO_IDENTIFICACAO ? identificacaoValida : etapaAtual ? validas[passo - 1] === true : false;

  const severidades = CHECKLIST_ETAPAS.filter((e) => etapas[e.categoria].fase === 'enviada').map((e) => etapas[e.categoria].severidade);
  const statusGeral = calcularStatusChecklist(severidades);
  const contagem = contarSeveridades(severidades);
  const fotosEnviadas = CHECKLIST_ETAPAS.filter((e) => etapas[e.categoria].fase === 'enviada').length;
  const nenhumaFoto = fotosEnviadas === 0 && !algumOcupado;

  function motivoBloqueio(): string | null {
    if (podeAvancar) return null;
    if (passo === PASSO_IDENTIFICACAO) return 'Selecione o veículo e o motorista.';
    if (!etapaAtual) return null;
    const e = etapas[etapaAtual.categoria];
    if (e.fase === 'processando' || e.fase === 'enviando') return 'Aguarde o envio da foto…';
    if (e.fase !== 'enviada') return 'Tire a foto desta etapa para continuar.';
    if (e.severidade !== 'ok' && !e.observacao.trim()) return 'Descreva a inconformidade para continuar.';
    if (etapaAtual.categoria === 'painel' && !kmValido) return `Informe o KM do hodômetro (mínimo ${veiculo?.km_atual ?? 0}).`;
    return null;
  }

  /* ------------------------------ envio ------------------------------ */

  function enviar() {
    if (!veiculo || !todasValidas) return;
    setErroEnvio(null);
    startEnviar(async () => {
      const resultado = await salvarChecklist({
        checklistId,
        veiculoId: veiculo.id,
        motoristaId,
        kmAtual: kmNumero,
        observacoesGerais: observacoesGerais.trim() || undefined,
        itens: CHECKLIST_ETAPAS.map((e) => {
          const s = etapas[e.categoria];
          return {
            categoria: e.categoria,
            fotoPath: s.fotoPath ?? '',
            severidade: s.severidade,
            observacao: s.observacao.trim() || undefined,
            marcadores: s.marcadores,
          };
        }),
      });
      if (resultado.ok) {
        setConcluido(true); // impede que o debounce recrie o rascunho depois de limpá-lo
        clearDraft(userId);
        toast.success('Checklist enviado com sucesso!');
        router.replace(`/checklists/${resultado.id}`);
      } else {
        setErroEnvio(resultado.message);
        toast.error(resultado.message);
      }
    });
  }

  /* ------------------------------ render ------------------------------ */

  if (veiculos.length === 0 || motoristas.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 py-10 text-center">
        <AlertTriangle className="mx-auto size-10 text-warning" />
        <h1 className="text-xl font-bold">Cadastros pendentes</h1>
        <p className="text-sm text-muted-foreground">
          Para iniciar um checklist é preciso ter ao menos {veiculos.length === 0 ? 'um veículo' : 'um motorista ativo'} cadastrado
          {veiculos.length === 0 && motoristas.length === 0 ? ' e um motorista ativo' : ''}.
        </p>
        <div className="flex flex-col gap-2">
          {veiculos.length === 0 ? <Link href="/veiculos/novo" className={buttonVariants({ size: 'lg' })}>Cadastrar veículo</Link> : null}
          {motoristas.length === 0 ? <Link href="/motoristas/novo" className={buttonVariants({ size: 'lg' })}>Cadastrar motorista</Link> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      {/* Cabeçalho fixo: progresso + status geral em tempo real */}
      <header className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 pt-safe backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-center justify-between gap-2 py-2.5">
          <div className="flex items-center gap-2">
            <Link href="/checklists" aria-label="Sair do checklist (o progresso é salvo)" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
              <X />
            </Link>
            <div>
              <p className="text-sm leading-tight font-semibold">Novo checklist</p>
              <p className="text-xs text-muted-foreground">
                {veiculo ? `${veiculo.placa} · ` : ''}
                {fotosEnviadas}/{TOTAL_ETAPAS} fotos
              </p>
            </div>
          </div>
          {fotosEnviadas > 0 ? (
            <div className="flex items-center gap-2" aria-live="polite">
              {contagem.atencao > 0 ? <span className="text-xs font-medium text-warning-foreground dark:text-warning">{contagem.atencao} atenção</span> : null}
              {contagem.critico > 0 ? <span className="text-xs font-medium text-destructive">{contagem.critico} avaria</span> : null}
              <ChecklistStatusBadge status={statusGeral} />
            </div>
          ) : null}
        </div>
        <ol className="flex gap-1 pb-2.5" aria-label="Progresso das etapas">
          {CHECKLIST_ETAPAS.map((e, i) => {
            const s = etapas[e.categoria];
            const desbloqueada = i + 1 <= passoMaximo;
            return (
              <li key={e.categoria} className="flex-1">
                <button
                  type="button"
                  disabled={!desbloqueada}
                  onClick={() => setPasso(i + 1)}
                  aria-label={`Etapa ${i + 1}: ${e.titulo}${s.fase === 'enviada' ? ` — ${SEVERIDADE_LABEL[s.severidade]}` : ''}`}
                  aria-current={passo === i + 1 ? 'step' : undefined}
                  className={cn(
                    'h-2.5 w-full rounded-full transition-colors',
                    s.fase === 'enviada' ? SEVERIDADE_BAR[s.severidade] : 'bg-muted',
                    passo === i + 1 && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                    !desbloqueada && 'opacity-50',
                  )}
                />
              </li>
            );
          })}
        </ol>
      </header>

      <div className="flex-1 py-4 pb-40">
        {rascunho ? (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-primary/30 bg-accent p-4" role="alert">
            <p className="text-sm font-medium">
              Há um checklist em andamento
              {veiculos.find((v) => v.id === rascunho.veiculoId) ? ` (${veiculos.find((v) => v.id === rascunho.veiculoId)!.placa})` : ''} com{' '}
              {Object.keys(rascunho.etapas).length}/{TOTAL_ETAPAS} fotos. Deseja continuar de onde parou?
            </p>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={restaurando} onClick={() => restaurarRascunho(rascunho)}>
                {restaurando ? <Loader2 className="animate-spin" /> : null} Continuar
              </Button>
              <Button type="button" variant="outline" className="flex-1" disabled={restaurando} onClick={descartarRascunho}>
                <Trash2 /> Descartar
              </Button>
            </div>
          </div>
        ) : null}

        {passo === PASSO_IDENTIFICACAO ? (
          <section className="flex flex-col gap-4" aria-labelledby="ident-titulo">
            <header>
              <h2 id="ident-titulo" className="text-xl font-bold">
                Identificação
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Escolha o veículo e o motorista. Depois serão {TOTAL_ETAPAS} fotos obrigatórias.</p>
            </header>
            <Field
              label="Veículo"
              htmlFor="veiculo"
              required
              hint={!nenhumaFoto ? 'Para trocar de veículo, descarte o rascunho.' : undefined}
            >
              <Select
                id="veiculo"
                value={veiculoId}
                disabled={!nenhumaFoto}
                onChange={(e) => {
                  const novo = veiculos.find((v) => v.id === e.target.value);
                  setVeiculoId(e.target.value);
                  setMotoristaId('');
                  setKmAtual(novo ? String(novo.km_atual) : '');
                }}
                className="h-12"
              >
                <option value="" disabled>
                  Selecione o veículo…
                </option>
                {veiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa}
                    {v.modelo ? ` · ${v.modelo}` : ''}
                    {v.filialLabel ? ` — ${v.filialLabel}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Motorista" htmlFor="motorista" required hint={veiculo && motoristasDaFilial.length === 0 ? 'Nenhum motorista ativo nesta filial.' : undefined}>
              <Select id="motorista" value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)} disabled={!veiculo} className="h-12">
                <option value="" disabled>
                  {veiculo ? 'Selecione o motorista…' : 'Selecione o veículo primeiro'}
                </option>
                {motoristasDaFilial.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </section>
        ) : null}

        {etapaAtual ? (
          <EtapaCaptura
            key={etapaAtual.categoria}
            indice={passo}
            total={TOTAL_ETAPAS}
            etapa={etapaAtual}
            estado={etapas[etapaAtual.categoria]}
            onFile={(file) => void processarFoto(etapaAtual.categoria, file)}
            onRetry={() => void enviarFoto(etapaAtual.categoria)}
            onChange={(patch) => patchEtapa(etapaAtual.categoria, patch)}
          >
            {etapaAtual.categoria === 'painel' ? (
              <Field
                label="KM do hodômetro"
                htmlFor="km"
                required
                error={kmAtual && !kmValido ? `O KM não pode ser menor que o último registrado (${veiculo?.km_atual ?? 0}).` : undefined}
                hint={`Último KM registrado: ${(veiculo?.km_atual ?? 0).toLocaleString('pt-BR')}`}
              >
                <Input id="km" type="number" inputMode="numeric" min={veiculo?.km_atual ?? 0} value={kmAtual} onChange={(e) => setKmAtual(e.target.value)} className="h-12 text-lg" />
              </Field>
            ) : null}
          </EtapaCaptura>
        ) : null}

        {passo === PASSO_REVISAO ? (
          <section className="flex flex-col gap-4" aria-labelledby="rev-titulo">
            <header>
              <h2 id="rev-titulo" className="text-xl font-bold">
                Revisão final
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Confira as fotos. Toque em uma etapa para ajustar.</p>
            </header>

            <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
              <span className="text-sm text-muted-foreground">Status do checklist:</span>
              <ChecklistStatusBadge status={statusGeral} />
              <span className="ml-auto text-xs text-muted-foreground">
                {contagem.ok} ok · {contagem.atencao} atenção · {contagem.critico} avaria
              </span>
            </div>

            <ul className="grid grid-cols-3 gap-2">
              {CHECKLIST_ETAPAS.map((e, i) => {
                const s = etapas[e.categoria];
                return (
                  <li key={e.categoria}>
                    <button
                      type="button"
                      onClick={() => setPasso(i + 1)}
                      className={cn('relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-muted text-left', {
                        'border-success': s.severidade === 'ok',
                        'border-warning': s.severidade === 'atencao',
                        'border-destructive': s.severidade === 'critico',
                      })}
                      aria-label={`Etapa ${i + 1}: ${e.titulo} — ${SEVERIDADE_LABEL[s.severidade]}. Toque para editar`}
                    >
                      {s.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.previewUrl} alt="" className="size-full object-cover" />
                      ) : null}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {i + 1}. {e.titulo}
                      </span>
                      {s.severidade !== 'ok' ? (
                        <span
                          className={cn(
                            'absolute top-1 right-1 flex size-5 items-center justify-center rounded-full text-white',
                            s.severidade === 'critico' ? 'bg-destructive' : 'bg-warning text-warning-foreground',
                          )}
                        >
                          <AlertTriangle className="size-3" />
                        </span>
                      ) : (
                        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-success text-white">
                          <Check className="size-3" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <Field label="Observações gerais" htmlFor="obs-gerais" hint="Opcional.">
              <Textarea id="obs-gerais" rows={3} maxLength={2000} value={observacoesGerais} onChange={(e) => setObservacoesGerais(e.target.value)} placeholder="Algo mais que o supervisor precise saber?" />
            </Field>

            {erroEnvio ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {erroEnvio}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      {/* Barra de ações fixa, otimizada para o polegar */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 pt-3 pb-safe backdrop-blur">
        <div className="mx-auto flex max-w-xl flex-col gap-2 pb-3">
          {motivoBloqueio() ? (
            <p className="text-center text-xs text-muted-foreground" role="status">
              {motivoBloqueio()}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="xl"
              className="w-24 shrink-0"
              disabled={passo === PASSO_IDENTIFICACAO || enviando}
              onClick={() => setPasso((p) => Math.max(PASSO_IDENTIFICACAO, p - 1))}
              aria-label="Etapa anterior"
            >
              <ArrowLeft className="size-5" />
            </Button>
            {passo === PASSO_REVISAO ? (
              <Button type="button" size="xl" variant="success" className="flex-1" disabled={!todasValidas || enviando} onClick={enviar}>
                {enviando ? <Loader2 className="animate-spin" /> : <Send className="size-5" />}
                {enviando ? 'Enviando…' : 'Enviar checklist'}
              </Button>
            ) : (
              <Button type="button" size="xl" className="flex-1" disabled={!podeAvancar} onClick={() => setPasso((p) => Math.min(PASSO_REVISAO, p + 1))}>
                {passo === TOTAL_ETAPAS ? (
                  <>
                    Revisar <CircleCheck className="size-5" />
                  </>
                ) : (
                  <>
                    Próxima <ArrowRight className="size-5" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
