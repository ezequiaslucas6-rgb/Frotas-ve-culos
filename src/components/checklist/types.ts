import type { ChecklistTipo, MarcadorAvaria, Severidade } from '@/lib/checklist/etapas';

export type FaseEtapa = 'vazia' | 'processando' | 'enviando' | 'enviada' | 'erro';

export interface EtapaState {
  fase: FaseEtapa;
  /** caminho no bucket "checklists" após o upload */
  fotoPath: string | null;
  /** blob: local (acabou de capturar) ou URL assinada (rascunho restaurado) */
  previewUrl: string | null;
  severidade: Severidade;
  observacao: string;
  marcadores: MarcadorAvaria[];
  /** "2,4 MB → 310 KB" */
  tamanho?: string;
  erro?: string;
}

/** Estado de cada item, pelo código do catálogo (checklist_itens.codigo). */
export type EtapasState = Partial<Record<string, EtapaState>>;

/** Respostas das perguntas Sim/Não (itens condicionais), pelo código do item. */
export type RespostasState = Partial<Record<string, boolean>>;

export interface VeiculoWizard {
  id: string;
  filial_id: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  km_atual: number;
  filialLabel: string | null;
}

export interface MotoristaWizard {
  id: string;
  filial_id: string;
  nome: string;
}

export interface EtapaSalva {
  fotoPath: string;
  severidade: Severidade;
  observacao: string;
  marcadores: MarcadorAvaria[];
}

/** Subconjunto persistido em localStorage (sem blobs): permite retomar após o WebView ser recarregado. */
export interface ChecklistDraft {
  checklistId: string;
  tipo: ChecklistTipo;
  veiculoId: string;
  motoristaId: string;
  kmAtual: string;
  observacoesGerais: string;
  /** código do item aberto (ou "identificacao" / "revisao") */
  passo: string;
  etapas: Partial<Record<string, EtapaSalva>>;
  respostas: RespostasState;
  savedAt: number;
}
