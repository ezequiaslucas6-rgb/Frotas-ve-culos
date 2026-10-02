import type { CategoriaFoto, MarcadorAvaria, Severidade } from '@/lib/checklist/etapas';

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

export type EtapasState = Record<CategoriaFoto, EtapaState>;

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

/** Subconjunto persistido em localStorage (sem blobs): permite retomar após o WebView ser recarregado. */
export interface ChecklistDraft {
  checklistId: string;
  veiculoId: string;
  motoristaId: string;
  kmAtual: string;
  observacoesGerais: string;
  passo: number;
  etapas: Partial<
    Record<CategoriaFoto, { fotoPath: string; severidade: Severidade; observacao: string; marcadores: MarcadorAvaria[] }>
  >;
  savedAt: number;
}
