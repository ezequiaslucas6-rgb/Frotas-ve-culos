'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleCheck, CircleX, CloudOff, Loader2, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { salvarChecklist } from '@/actions/checklists';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { ChecklistStatusBadge } from '@/components/ui/status-badges';
import {
  ITEM_PAINEL,
  SEVERIDADE_LABEL,
  TIPOS_CHECKLIST,
  agruparItens,
  calcularStatusChecklist,
  caminhoFotoChecklist,
  contarSeveridades,
  fotoRecente,
  fotosEsperadas,
  tipoLabel,
  totalFotosObrigatorias,
  type ChecklistTipo,
  type ItemChecklist,
  type ModelosChecklist,
} from '@/lib/checklist/etapas';
import { compressImage, formatBytes } from '@/lib/image/compress';
import { ehFalhaDeRede, guardarEnvio, guardarFoto, lerFoto, marcarFotoEnviada, processarEnvio } from '@/lib/offline/fila';
import { createClient } from '@/lib/supabase/client';
import { uuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import { clearDraft, parseDraft, readDraftRaw, saveDraft, subscribeDraft } from './draft';
import { EtapaCaptura } from './etapa-captura';
import type { ChecklistDraft, EtapasState, EtapaState, MotoristaWizard, RespostasState, VeiculoWizard } from './types';

const PASSO_IDENTIFICACAO = 'identificacao';
const PASSO_REVISAO = 'revisao';
const UPLOAD_TENTATIVAS = 3;

const ETAPA_VAZIA: EtapaState = {
  fase: 'vazia',
  fotoPath: null,
  previewUrl: null,
  severidade: 'ok',
  observacao: '',
  marcadores: [],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A foto existe: no servidor ou guardada no aparelho (sem internet). */
const temFoto = (e: EtapaState) => e.fase === 'enviada' || e.fase === 'pendente';

const SEVERIDADE_BAR: Record<EtapaState['severidade'], string> = {
  ok: 'bg-success',
  atencao: 'bg-warning',
  critico: 'bg-destructive',
};

interface ChecklistWizardProps {
  userId: string;
  veiculos: VeiculoWizard[];
  motoristas: MotoristaWizard[];
  /** itens de cada tipo (checklist_modelo), já ordenados */
  modelos: ModelosChecklist;
  veiculoInicialId?: string;
  tipoInicial?: ChecklistTipo;
  /**
   * Motorista logado: o checklist é sempre em nome dele (id do próprio cadastro; null se o
   * cadastro não está ativo). Ausente para admin/supervisor, que escolhem o motorista.
   */
  motoristaFixoId?: string | null;
}

export function ChecklistWizard({ userId, veiculos, motoristas, modelos, veiculoInicialId, tipoInicial, motoristaFixoId }: ChecklistWizardProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [passo, setPasso] = useState<string>(PASSO_IDENTIFICACAO);
  // O id é gerado no cliente: as fotos sobem para <filial>/<checklistId>/ ANTES do envio final.
  const [checklistId, setChecklistId] = useState(uuid);
  const [tipo, setTipo] = useState<ChecklistTipo>(tipoInicial ?? 'diario');
  const [veiculoId, setVeiculoId] = useState(veiculos.some((v) => v.id === veiculoInicialId) ? (veiculoInicialId ?? '') : '');
  const souMotorista = motoristaFixoId !== undefined;
  const [motoristaId, setMotoristaId] = useState(motoristaFixoId ?? '');
  const [kmAtual, setKmAtual] = useState(() => String(veiculos.find((v) => v.id === veiculoInicialId)?.km_atual ?? ''));
  const [observacoesGerais, setObservacoesGerais] = useState('');
  // fotos por código do item: trocar o tipo mantém as fotos dos itens em comum
  const [etapas, setEtapas] = useState<EtapasState>({});
  const [respostas, setRespostas] = useState<RespostasState>({});
  const [decisaoRascunho, setDecisaoRascunho] = useState<'pendente' | 'resolvida'>('pendente');
  const [restaurando, setRestaurando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  /** placa do checklist guardado no aparelho (sem internet), aguardando o envio automático */
  const [guardadoNoAparelho, setGuardadoNoAparelho] = useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviando, startEnviar] = useTransition();

  const etapasRef = useRef(etapas);
  const blobs = useRef<Partial<Record<string, Blob>>>({});
  useEffect(() => {
    etapasRef.current = etapas;
  });

  const veiculo = veiculos.find((v) => v.id === veiculoId) ?? null;
  const motoristasDaFilial = useMemo(
    () => motoristas.filter((m) => m.filial_id === veiculo?.filial_id),
    [motoristas, veiculo?.filial_id],
  );

  /* ------------------------------ itens do tipo ------------------------------ */

  const grupos = useMemo(() => agruparItens(modelos[tipo] ?? []), [modelos, tipo]);
  const itens = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);
  const passos = useMemo(() => [PASSO_IDENTIFICACAO, ...itens.map((i) => i.codigo), PASSO_REVISAO], [itens]);
  // passo de um item que não existe no tipo atual (rascunho antigo, modelo alterado) => identificação
  const passoAtual = passos.includes(passo) ? passo : PASSO_IDENTIFICACAO;
  const indicePasso = passos.indexOf(passoAtual);
  const itemAtual = itens.find((i) => i.codigo === passoAtual) ?? null;
  const grupoAtual = itemAtual ? grupos.find((g) => g.grupo === itemAtual.grupo) : undefined;
  const temPainel = itens.some((i) => i.codigo === ITEM_PAINEL);
  const etapa = (codigo: string) => etapas[codigo] ?? ETAPA_VAZIA;

  // cada passo começa do topo (o celular costuma estar rolado até os botões de condição)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [passoAtual]);

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
      for (const [codigo, s] of Object.entries(etapas)) {
        if ((s?.fase === 'enviada' || s?.fase === 'pendente') && s.fotoPath) {
          salvas[codigo] = {
            fotoPath: s.fotoPath,
            local: s.fase === 'pendente',
            severidade: s.severidade,
            observacao: s.observacao,
            marcadores: s.marcadores,
          };
        }
      }
      saveDraft(userId, {
        checklistId,
        tipo,
        veiculoId,
        motoristaId,
        kmAtual,
        observacoesGerais,
        passo: passoAtual,
        etapas: salvas,
        respostas,
        savedAt: Date.now(),
      });
      // a partir daqui o rascunho no storage é o PRÓPRIO progresso desta sessão, nunca um "rascunho antigo pendente"
      setDecisaoRascunho('resolvida');
    }, 300);
    return () => clearTimeout(timer);
  }, [rascunho, concluido, userId, checklistId, tipo, veiculoId, motoristaId, kmAtual, observacoesGerais, passoAtual, etapas, respostas]);

  async function restaurarRascunho(d: ChecklistDraft) {
    setRestaurando(true);
    const salvas = Object.entries(d.etapas).filter((e): e is [string, NonNullable<(typeof e)[1]>] => Boolean(e[1]));
    const noServidor = salvas.filter(([, e]) => !e.local).map(([, e]) => e.fotoPath);
    const { data } = noServidor.length
      ? await supabase.storage.from('checklists').createSignedUrls(noServidor, 3600).catch(() => ({ data: null }))
      : { data: null };
    const urls = new Map((data ?? []).filter((i) => i.signedUrl && i.path).map((i) => [i.path as string, i.signedUrl]));

    // a foto vem do servidor ou do próprio aparelho (sem internet); se não houver nenhuma, precisa ser refeita
    const restauradas: EtapasState = {};
    for (const [codigo, salva] of salvas) {
      const url = urls.get(salva.fotoPath);
      const local = url ? undefined : await lerFoto(salva.fotoPath);
      if (url) {
        restauradas[codigo] = { ...ETAPA_VAZIA, ...salva, fase: 'enviada', previewUrl: url };
      } else if (local) {
        blobs.current[codigo] = local.blob;
        restauradas[codigo] = { ...ETAPA_VAZIA, ...salva, fase: local.enviada ? 'enviada' : 'pendente', previewUrl: URL.createObjectURL(local.blob) };
      }
    }
    setChecklistId(d.checklistId);
    setTipo(modelos[d.tipo] ? d.tipo : 'diario');
    setVeiculoId(d.veiculoId);
    setMotoristaId(d.motoristaId);
    setKmAtual(d.kmAtual);
    setObservacoesGerais(d.observacoesGerais);
    setEtapas(restauradas);
    setRespostas(d.respostas);
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

  const patchEtapa = useCallback((codigo: string, patch: Partial<EtapaState>) => {
    setEtapas((prev) => ({ ...prev, [codigo]: { ...(prev[codigo] ?? ETAPA_VAZIA), ...patch } }));
  }, []);

  async function enviarFoto(codigo: string) {
    if (!veiculo) return;
    const path = caminhoFotoChecklist(veiculo.filial_id, checklistId, codigo);
    const blob = blobs.current[codigo] ?? (await lerFoto(path))?.blob;
    if (!blob) return;
    // sem internet: a foto já está guardada no aparelho e sobe sozinha depois
    if (!navigator.onLine) {
      patchEtapa(codigo, { fase: 'pendente', fotoPath: path, erro: undefined });
      return;
    }
    patchEtapa(codigo, { fase: 'enviando', erro: undefined });

    let ultimoErro: unknown = null;
    for (let tentativa = 1; tentativa <= UPLOAD_TENTATIVAS; tentativa++) {
      const { error } = await supabase.storage
        .from('checklists')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (!error) {
        await marcarFotoEnviada(path);
        patchEtapa(codigo, { fase: 'enviada', fotoPath: path, erro: undefined });
        return;
      }
      ultimoErro = error;
      if (!navigator.onLine) break;
      if (tentativa < UPLOAD_TENTATIVAS) await sleep(tentativa * 1000);
    }
    if (ehFalhaDeRede(ultimoErro) && (await lerFoto(path))) {
      // internet caiu ou servidor fora: segue o checklist; a foto sobe quando a conexão voltar
      patchEtapa(codigo, { fase: 'pendente', fotoPath: path, erro: undefined });
    } else {
      patchEtapa(codigo, { fase: 'erro', erro: 'Não foi possível enviar a foto. Verifique a conexão e tente novamente.' });
    }
  }

  async function processarFoto(codigo: string, file: File) {
    if (!veiculo) return;
    // só câmera: um arquivo antigo é foto de galeria (ou de outro dia)
    if (!fotoRecente(file.lastModified)) {
      patchEtapa(codigo, { erro: 'Foto antiga não é aceita. Toque em "Tirar foto" e fotografe agora.' });
      return;
    }
    patchEtapa(codigo, { fase: 'processando', erro: undefined });
    try {
      const comprimida = await compressImage(file, { maxDimension: 1600, quality: 0.8 });
      blobs.current[codigo] = comprimida.blob;
      // guardada no aparelho primeiro: se a internet cair (ou o app fechar), a foto não se perde
      await guardarFoto({ path: caminhoFotoChecklist(veiculo.filial_id, checklistId, codigo), checklistId, userId, blob: comprimida.blob });
      const anterior = etapasRef.current[codigo]?.previewUrl;
      if (anterior?.startsWith('blob:')) URL.revokeObjectURL(anterior);
      patchEtapa(codigo, {
        previewUrl: URL.createObjectURL(comprimida.blob),
        tamanho: `${formatBytes(comprimida.originalSize)} → ${formatBytes(comprimida.blob.size)}`,
        fotoPath: null,
      });
      await enviarFoto(codigo);
    } catch {
      patchEtapa(codigo, {
        fase: etapasRef.current[codigo]?.previewUrl ? 'erro' : 'vazia',
        erro: 'Não foi possível processar esta imagem. Tire outra foto.',
      });
    }
  }

  function responder(item: ItemChecklist, valor: boolean) {
    setRespostas((prev) => ({ ...prev, [item.codigo]: valor }));
    // vazamento/avaria nunca é "Conforme"
    if (valor && etapa(item.codigo).severidade === 'ok') patchEtapa(item.codigo, { severidade: 'atencao' });
  }

  // blobs locais são liberados ao sair
  useEffect(
    () => () => {
      for (const e of Object.values(etapasRef.current)) if (e?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(e.previewUrl);
    },
    [],
  );

  // aviso ao tentar fechar com upload em andamento
  const algumOcupado = Object.values(etapas).some((e) => e?.fase === 'processando' || e?.fase === 'enviando');
  useEffect(() => {
    if (!algumOcupado) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [algumOcupado]);

  /* ------------------------------ validação ------------------------------ */

  const kmNumero = Number(kmAtual);
  const kmValido = kmAtual.trim() !== '' && Number.isInteger(kmNumero) && kmNumero >= (veiculo?.km_atual ?? 0);

  const itemValido = (item: ItemChecklist) => {
    const e = etapa(item.codigo);
    if (item.condicional) {
      const resposta = respostas[item.codigo];
      if (resposta === undefined) return false;
      return !resposta || (temFoto(e) && e.severidade !== 'ok' && e.observacao.trim().length > 0);
    }
    const base = temFoto(e) && (e.severidade === 'ok' || e.observacao.trim().length > 0);
    return item.codigo === ITEM_PAINEL ? base && kmValido : base;
  };

  const identificacaoValida = Boolean(veiculo && motoristaId) && itens.length > 0 && (temPainel || kmValido);
  const validas = itens.map(itemValido);
  const primeiroPendente = validas.indexOf(false); // -1 => tudo pronto
  const todasValidas = primeiroPendente === -1;
  const passoMaximo = !identificacaoValida ? 0 : todasValidas ? passos.length - 1 : primeiroPendente + 1;
  const podeAvancar = passoAtual === PASSO_IDENTIFICACAO ? identificacaoValida : itemAtual ? itemValido(itemAtual) : false;

  const esperados = fotosEsperadas(itens, respostas);
  const enviadas = esperados.filter((c) => temFoto(etapa(c)));
  const noAparelho = esperados.filter((c) => etapa(c).fase === 'pendente').length;
  const severidades = enviadas.map((c) => etapa(c).severidade);
  const statusGeral = calcularStatusChecklist(severidades);
  const contagem = contarSeveridades(severidades);
  const nenhumaFoto = !Object.values(etapas).some((e) => e && e.fase !== 'vazia');

  function motivoBloqueio(): string | null {
    if (podeAvancar) return null;
    if (passoAtual === PASSO_IDENTIFICACAO) {
      if (!veiculo || !motoristaId) return souMotorista ? 'Selecione o veículo.' : 'Selecione o veículo e o motorista.';
      if (itens.length === 0) return 'Este tipo de checklist não tem fotos configuradas.';
      return `Informe o KM do hodômetro (mínimo ${veiculo.km_atual}).`;
    }
    if (!itemAtual) return null;
    const e = etapa(itemAtual.codigo);
    if (itemAtual.condicional) {
      const resposta = respostas[itemAtual.codigo];
      if (resposta === undefined) return 'Responda Sim ou Não para continuar.';
    }
    if (e.fase === 'processando' || e.fase === 'enviando') return 'Aguarde o envio da foto…';
    if (!temFoto(e)) return itemAtual.condicional ? 'Tire a foto do vazamento ou da avaria.' : 'Tire a foto deste item para continuar.';
    if (itemAtual.condicional && e.severidade === 'ok') return 'Classifique como Atenção ou Avaria.';
    if (e.severidade !== 'ok' && !e.observacao.trim()) return 'Descreva a inconformidade para continuar.';
    if (itemAtual.codigo === ITEM_PAINEL && !kmValido) return `Informe o KM do hodômetro (mínimo ${veiculo?.km_atual ?? 0}).`;
    return null;
  }

  /* ------------------------------ envio ------------------------------ */

  function enviar() {
    if (!veiculo || !todasValidas) return;
    setErroEnvio(null);
    const payload = {
      checklistId,
      tipo,
      veiculoId: veiculo.id,
      motoristaId,
      kmAtual: kmNumero,
      observacoesGerais: observacoesGerais.trim() || undefined,
      respostas: Object.fromEntries(itens.filter((i) => i.condicional).map((i) => [i.codigo, respostas[i.codigo] === true])),
      itens: esperados.map((codigo) => {
        const s = etapa(codigo);
        return {
          categoria: codigo,
          fotoPath: s.fotoPath ?? '',
          severidade: s.severidade,
          observacao: s.observacao.trim() || undefined,
          marcadores: s.marcadores,
        };
      }),
    };
    startEnviar(async () => {
      // 1º guarda no aparelho: se a internet cair no meio, nada se perde e o envio é automático depois
      const envio = { checklistId, userId, placa: veiculo.placa, payload };
      const naFila = await guardarEnvio(envio);
      const resultado = naFila
        ? await processarEnvio({ ...envio, criadoEm: Date.now() }, supabase, salvarChecklist)
        : await salvarChecklist(payload)
            .then((r): Awaited<ReturnType<typeof processarEnvio>> =>
              r.ok ? { estado: 'enviado', id: r.id, status: r.status } : { estado: 'recusado', mensagem: r.message },
            )
            .catch((): Awaited<ReturnType<typeof processarEnvio>> => ({ estado: 'recusado', mensagem: 'Sem conexão. Tente de novo quando a internet voltar.' }));

      if (resultado.estado === 'enviado') {
        setConcluido(true); // impede que o debounce recrie o rascunho depois de limpá-lo
        clearDraft(userId);
        if (resultado.status === 'critico') {
          // a avaria crítica abre a manutenção e deixa o veículo não liberado (migration 20260107)
          toast.warning('Avaria crítica registrada: o veículo fica NÃO LIBERADO até o conserto ou a liberação do supervisor.', {
            duration: 10000,
          });
        } else {
          toast.success('Checklist enviado com sucesso!');
        }
        router.replace(`/checklists/${resultado.id}`);
      } else if (resultado.estado === 'aguardando') {
        // sem internet: fica na fila do aparelho e é enviado sozinho quando a conexão voltar
        setConcluido(true);
        clearDraft(userId);
        setGuardadoNoAparelho(veiculo.placa);
      } else {
        setErroEnvio(resultado.mensagem);
        toast.error(resultado.mensagem);
      }
    });
  }

  /** Depois de guardar sem internet: começa outro checklist do zero. */
  function novoChecklist() {
    for (const e of Object.values(etapasRef.current)) if (e?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(e.previewUrl);
    blobs.current = {};
    setChecklistId(uuid());
    setEtapas({});
    setRespostas({});
    setObservacoesGerais('');
    setPasso(PASSO_IDENTIFICACAO);
    setGuardadoNoAparelho(null);
    setConcluido(false);
  }

  /* ------------------------------ render ------------------------------ */

  if (guardadoNoAparelho) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 py-10 text-center" role="status">
        <CloudOff className="mx-auto size-12 text-icone" />
        <h1 className="text-xl font-bold">Checklist guardado no aparelho</h1>
        <p className="text-sm text-muted-foreground">
          Sem internet agora. O checklist do {guardadoNoAparelho} e as fotos ficaram salvos neste celular e serão enviados
          sozinhos assim que a conexão voltar — não precisa fazer de novo.
        </p>
        <Button type="button" size="lg" onClick={novoChecklist}>
          Fazer outro checklist
        </Button>
        <Link href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Voltar ao início
        </Link>
      </div>
    );
  }

  // motorista sem cadastro ativo ou sem veículo: quem resolve é o supervisor
  if (souMotorista && (!motoristaFixoId || veiculos.length === 0)) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 py-10 text-center">
        <AlertTriangle className="mx-auto size-10 text-warning" />
        <h1 className="text-xl font-bold">{motoristaFixoId ? 'Nenhum veículo com você' : 'Cadastro inativo'}</h1>
        <p className="text-sm text-muted-foreground">
          {motoristaFixoId
            ? 'Para fazer o checklist, peça ao seu supervisor para vincular o veículo a você.'
            : 'Seu cadastro de motorista não está ativo. Fale com o seu supervisor.'}
        </p>
        <Link href="/meu-veiculo" className={buttonVariants({ size: 'lg' })}>
          Voltar ao Meu veículo
        </Link>
      </div>
    );
  }

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

  const campoKm = (
    <Field
      label="KM do hodômetro"
      htmlFor="km"
      required
      error={kmAtual && !kmValido ? `O KM não pode ser menor que o último registrado (${veiculo?.km_atual ?? 0}).` : undefined}
      hint={`Último KM registrado: ${(veiculo?.km_atual ?? 0).toLocaleString('pt-BR')}`}
    >
      <Input id="km" type="number" inputMode="numeric" min={veiculo?.km_atual ?? 0} value={kmAtual} onChange={(e) => setKmAtual(e.target.value)} className="h-12 text-lg" />
    </Field>
  );

  const corDoItem = (item: ItemChecklist) => {
    if (item.condicional && respostas[item.codigo] === false) return 'bg-success';
    if (item.condicional && respostas[item.codigo] === undefined) return 'bg-muted';
    const s = etapa(item.codigo);
    return temFoto(s) ? SEVERIDADE_BAR[s.severidade] : 'bg-muted';
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      {/* Cabeçalho fixo: progresso por grupo + status geral em tempo real */}
      <header className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 pt-safe backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-center justify-between gap-2 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/checklists" aria-label="Sair do checklist (o progresso é salvo)" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
              <X />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm leading-tight font-semibold">Checklist {tipoLabel(tipo).toLowerCase()}</p>
              <p className="truncate text-xs text-muted-foreground">
                {veiculo ? `${veiculo.placa} · ` : ''}
                {enviadas.length}/{esperados.length} fotos
                {noAparelho > 0 ? ` · ${noAparelho} no aparelho` : ''}
              </p>
            </div>
          </div>
          {enviadas.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2" aria-live="polite">
              {contagem.atencao > 0 ? <span className="hidden text-xs font-medium text-warning-text min-[380px]:inline">{contagem.atencao} atenção</span> : null}
              {contagem.critico > 0 ? <span className="hidden text-xs font-medium text-destructive-text min-[380px]:inline">{contagem.critico} avaria</span> : null}
              <ChecklistStatusBadge status={statusGeral} />
            </div>
          ) : null}
        </div>
        <ol className="flex gap-1.5 pb-1.5" aria-label="Progresso por grupo">
          {grupos.map((g) => (
            <li key={g.grupo} className="flex gap-0.5" style={{ flex: `${g.itens.length} 1 0%` }}>
              {g.itens.map((item) => {
                const desbloqueado = passos.indexOf(item.codigo) <= passoMaximo;
                const s = etapa(item.codigo);
                return (
                  <button
                    key={item.codigo}
                    type="button"
                    disabled={!desbloqueado}
                    onClick={() => setPasso(item.codigo)}
                    aria-label={`${g.grupo}: ${item.nome}${temFoto(s) ? ` — ${SEVERIDADE_LABEL[s.severidade]}` : ''}`}
                    aria-current={passoAtual === item.codigo ? 'step' : undefined}
                    className={cn(
                      'h-2.5 min-w-0 flex-1 rounded-full transition-colors',
                      corDoItem(item),
                      passoAtual === item.codigo && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                      !desbloqueado && 'opacity-50',
                    )}
                  />
                );
              })}
            </li>
          ))}
        </ol>
        <p className="truncate pb-2 text-xs font-medium text-muted-foreground">
          {grupoAtual
            ? `${grupoAtual.grupo} · ${grupoAtual.itens.indexOf(itemAtual!) + 1} de ${grupoAtual.itens.length}`
            : passoAtual === PASSO_REVISAO
              ? 'Revisão final'
              : 'Identificação'}
        </p>
      </header>

      <div className="flex-1 py-4 pb-40">
        {rascunho ? (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-primary/30 bg-accent p-4" role="alert">
            <p className="text-sm font-medium">
              Há um checklist {tipoLabel(rascunho.tipo).toLowerCase()} em andamento
              {veiculos.find((v) => v.id === rascunho.veiculoId) ? ` (${veiculos.find((v) => v.id === rascunho.veiculoId)!.placa})` : ''} com{' '}
              {Object.keys(rascunho.etapas).length} foto(s). Deseja continuar de onde parou?
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

        {passoAtual === PASSO_IDENTIFICACAO ? (
          <section className="flex flex-col gap-4" aria-labelledby="ident-titulo">
            <header>
              <h2 id="ident-titulo" className="text-xl font-bold">
                Identificação
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {souMotorista ? 'Escolha o tipo de checklist e confira o veículo.' : 'Escolha o tipo de checklist, o veículo e o motorista.'}
              </p>
            </header>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Tipo de checklist</legend>
              <div role="radiogroup" aria-label="Tipo de checklist" className="grid grid-cols-3 gap-2">
                {TIPOS_CHECKLIST.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={tipo === t.value}
                    data-active={tipo === t.value}
                    onClick={() => setTipo(t.value)}
                    className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 bg-card px-1 py-2 text-center transition-colors data-[active=true]:border-primary data-[active=true]:bg-accent"
                  >
                    <span className="text-sm font-semibold">{t.label}</span>
                    <span className="text-xs text-muted-foreground">{totalFotosObrigatorias(modelos[t.value] ?? [])} fotos</span>
                  </button>
                ))}
              </div>
              <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Grupos de fotos deste checklist">
                {grupos.map((g) => (
                  <li key={g.grupo} className="rounded-full border bg-card px-2.5 py-1 text-xs">
                    <span className="font-medium">{g.grupo}</span>{' '}
                    <span className="text-muted-foreground">
                      {g.itens.every((i) => i.condicional) ? 'Sim/Não' : g.itens.filter((i) => !i.condicional).length}
                    </span>
                  </li>
                ))}
              </ul>
            </fieldset>

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
                  setMotoristaId(motoristaFixoId ?? '');
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
              <Select id="motorista" value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)} disabled={!veiculo || souMotorista} className="h-12">
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
            {/* sem a foto do painel no modelo, o KM é pedido aqui */}
            {veiculo && !temPainel ? campoKm : null}
          </section>
        ) : null}

        {itemAtual ? (
          <section key={itemAtual.codigo} className="flex flex-col gap-4" aria-labelledby="etapa-titulo">
            <header>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{itemAtual.grupo}</p>
              <h2 id="etapa-titulo" className="text-xl font-bold">
                {itemAtual.condicional ? itemAtual.pergunta : itemAtual.nome}
              </h2>
              {itemAtual.instrucao && (!itemAtual.condicional || respostas[itemAtual.codigo]) ? (
                <p className="mt-1 text-sm text-muted-foreground">{itemAtual.instrucao}</p>
              ) : null}
            </header>

            {itemAtual.condicional ? (
              <div role="radiogroup" aria-label={itemAtual.pergunta ?? itemAtual.nome} className="grid grid-cols-2 gap-2">
                {([
                  { valor: true, label: 'Sim', icon: AlertTriangle, ativo: 'data-[active=true]:border-destructive data-[active=true]:bg-destructive/15 data-[active=true]:text-destructive-text' },
                  { valor: false, label: 'Não', icon: CircleCheck, ativo: 'data-[active=true]:border-success data-[active=true]:bg-success/15 data-[active=true]:text-success-text' },
                ] as const).map(({ valor, label, icon: Icon, ativo }) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={respostas[itemAtual.codigo] === valor}
                    data-active={respostas[itemAtual.codigo] === valor}
                    onClick={() => responder(itemAtual, valor)}
                    className={cn('flex min-h-16 items-center justify-center gap-2 rounded-xl border-2 bg-card text-lg font-semibold transition-colors', ativo)}
                  >
                    <Icon className="size-5" /> {label}
                  </button>
                ))}
              </div>
            ) : null}

            {!itemAtual.condicional || respostas[itemAtual.codigo] === true ? (
              <EtapaCaptura
                titulo={itemAtual.nome}
                estado={etapa(itemAtual.codigo)}
                somenteProblema={itemAtual.condicional}
                onFile={(file) => void processarFoto(itemAtual.codigo, file)}
                onRetry={() => void enviarFoto(itemAtual.codigo)}
                onChange={(patch) => patchEtapa(itemAtual.codigo, patch)}
              >
                {itemAtual.codigo === ITEM_PAINEL ? campoKm : null}
              </EtapaCaptura>
            ) : respostas[itemAtual.codigo] === false ? (
              <p className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-3 text-sm font-medium text-success-text">
                <CircleCheck className="size-5 shrink-0" /> Sem vazamento ou avaria. Nenhuma foto necessária.
              </p>
            ) : null}
          </section>
        ) : null}

        {passoAtual === PASSO_REVISAO ? (
          <section className="flex flex-col gap-4" aria-labelledby="rev-titulo">
            <header>
              <h2 id="rev-titulo" className="text-xl font-bold">
                Revisão final
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Confira as fotos de cada grupo. Toque em uma para ajustar.</p>
            </header>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
              <span className="text-sm text-muted-foreground">Status do checklist:</span>
              <ChecklistStatusBadge status={statusGeral} />
              <span className="ml-auto text-xs text-muted-foreground">
                {contagem.ok} ok · {contagem.atencao} atenção · {contagem.critico} avaria
              </span>
            </div>

            {grupos.map((g) => (
              <div key={g.grupo} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{g.grupo}</h3>
                <ul className="grid grid-cols-3 gap-2">
                  {g.itens.map((item) => {
                    const s = etapa(item.codigo);
                    if (item.condicional && respostas[item.codigo] !== true) {
                      return (
                        <li key={item.codigo}>
                          <button
                            type="button"
                            onClick={() => setPasso(item.codigo)}
                            className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-success bg-success/10 p-2 text-center text-success-text"
                            aria-label={`${item.nome}: Não. Toque para editar`}
                          >
                            <CircleCheck className="size-6" />
                            <span className="text-[11px] leading-tight font-medium">{item.nome}: Não</span>
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li key={item.codigo}>
                        <button
                          type="button"
                          onClick={() => setPasso(item.codigo)}
                          className={cn('relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-muted text-left', {
                            'border-success': s.severidade === 'ok',
                            'border-warning': s.severidade === 'atencao',
                            'border-destructive': s.severidade === 'critico',
                          })}
                          aria-label={`${item.nome} — ${SEVERIDADE_LABEL[s.severidade]}. Toque para editar`}
                        >
                          {s.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.previewUrl} alt="" className="size-full object-cover" />
                          ) : null}
                          <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {item.nome}
                          </span>
                          {s.severidade !== 'ok' ? (
                            <span
                              className={cn(
                                'absolute top-1 right-1 flex size-5 items-center justify-center rounded-full text-white',
                                s.severidade === 'critico' ? 'bg-destructive' : 'bg-warning',
                              )}
                            >
                              {item.condicional ? <CircleX className="size-3" /> : <AlertTriangle className="size-3" />}
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
              </div>
            ))}

            <Field label="Observações gerais" htmlFor="obs-gerais" hint="Opcional.">
              <Textarea id="obs-gerais" rows={3} maxLength={2000} value={observacoesGerais} onChange={(e) => setObservacoesGerais(e.target.value)} placeholder="Algo mais que o supervisor precise saber?" />
            </Field>

            {erroEnvio ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive-text">
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
              disabled={indicePasso === 0 || enviando}
              onClick={() => setPasso(passos[Math.max(0, indicePasso - 1)] ?? PASSO_IDENTIFICACAO)}
              aria-label="Etapa anterior"
            >
              <ArrowLeft className="size-5" />
            </Button>
            {passoAtual === PASSO_REVISAO ? (
              <Button type="button" size="xl" variant="success" className="flex-1" disabled={!todasValidas || enviando} onClick={enviar}>
                {enviando ? <Loader2 className="animate-spin" /> : <Send className="size-5" />}
                {enviando ? 'Enviando…' : 'Enviar checklist'}
              </Button>
            ) : (
              <Button type="button" size="xl" className="flex-1" disabled={!podeAvancar} onClick={() => setPasso(passos[Math.min(passos.length - 1, indicePasso + 1)] ?? PASSO_REVISAO)}>
                {passos[indicePasso + 1] === PASSO_REVISAO ? (
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
