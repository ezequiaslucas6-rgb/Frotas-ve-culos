import type { Enums, Tables } from '@/types/database';

export type ChecklistTipo = Enums<'checklist_tipo'>;
export type Severidade = Enums<'checklist_status'>;

/** Item do catálogo (tabela checklist_itens): uma foto do checklist ou uma pergunta Sim/Não com foto. */
export type ItemChecklist = Pick<
  Tables<'checklist_itens'>,
  'codigo' | 'nome' | 'grupo' | 'instrucao' | 'pergunta' | 'ordem' | 'condicional'
>;

/** Itens de cada tipo, já na ordem do assistente (vem de checklist_modelo; o admin ajusta). */
export type ModelosChecklist = Record<ChecklistTipo, ItemChecklist[]>;

export const TIPOS_CHECKLIST: ReadonlyArray<{ value: ChecklistTipo; label: string; descricao: string }> = [
  { value: 'diario', label: 'Diário', descricao: 'Antes de sair com o veículo, até as 08:30.' },
  { value: 'semanal', label: 'Semanal', descricao: 'Obrigatório no sábado ou domingo.' },
  { value: 'mensal', label: 'Mensal', descricao: 'Inspeção completa do mês.' },
];

export const tipoLabel = (tipo: ChecklistTipo) => TIPOS_CHECKLIST.find((t) => t.value === tipo)?.label ?? tipo;

/** Item que dá o KM do checklist (foto do hodômetro). */
export const ITEM_PAINEL = 'painel';

export const ordenarItens = <T extends { ordem: number }>(itens: readonly T[]): T[] =>
  [...itens].sort((a, b) => a.ordem - b.ordem);

/** Agrupa os itens mantendo a ordem: os grupos aparecem na ordem do seu primeiro item. */
export function agruparItens<T extends { grupo: string; ordem: number }>(itens: readonly T[]): Array<{ grupo: string; itens: T[] }> {
  const grupos = new Map<string, T[]>();
  for (const item of ordenarItens(itens)) {
    const lista = grupos.get(item.grupo);
    if (lista) lista.push(item);
    else grupos.set(item.grupo, [item]);
  }
  return [...grupos].map(([grupo, lista]) => ({ grupo, itens: lista }));
}

/**
 * Fotos exigidas: todos os itens comuns + os condicionais respondidos com "Sim".
 * Mesma regra da RPC salvar_checklist (supabase/migrations/20260105000000_checklist_tipos.sql).
 */
export function fotosEsperadas(itens: readonly ItemChecklist[], respostas: Record<string, boolean | undefined>): string[] {
  return ordenarItens(itens)
    .filter((i) => !i.condicional || respostas[i.codigo] === true)
    .map((i) => i.codigo);
}

/** Quantas fotos o tipo pede, sem contar as perguntas Sim/Não. */
export const totalFotosObrigatorias = (itens: readonly ItemChecklist[]) => itens.filter((i) => !i.condicional).length;

export const SEVERIDADE_LABEL: Record<Severidade, string> = {
  ok: 'Conforme',
  atencao: 'Atenção',
  critico: 'Avaria',
};

const PESO: Record<Severidade, number> = { ok: 0, atencao: 1, critico: 2 };

/** Status geral do checklist: a pior severidade entre os itens (mesma regra da RPC salvar_checklist). */
export function calcularStatusChecklist(severidades: Iterable<Severidade>): Severidade {
  let pior: Severidade = 'ok';
  for (const s of severidades) if (PESO[s] > PESO[pior]) pior = s;
  return pior;
}

export function contarSeveridades(severidades: Iterable<Severidade>): Record<Severidade, number> {
  const total: Record<Severidade, number> = { ok: 0, atencao: 0, critico: 0 };
  for (const s of severidades) total[s]++;
  return total;
}

/** Caminho no bucket "checklists": <filial>/<checklist>/<item>.jpg */
export const caminhoFotoChecklist = (filialId: string, checklistId: string, item: string) => `${filialId}/${checklistId}/${item}.jpg`;

/** Foto da câmera precisa ser recente: fotos antigas (de galeria) são recusadas. */
export const IDADE_MAXIMA_FOTO_MS = 15 * 60 * 1000;

/**
 * true se o arquivo parece ter vindo agora da câmera. Quando o navegador não informa a
 * data (0 ou inválida, comum em WebView), aceita — a câmera já é a única opção oferecida.
 */
export function fotoRecente(lastModified: number, agora = Date.now()): boolean {
  if (!Number.isFinite(lastModified) || lastModified <= 946_684_800_000 /* 2000-01-01 */) return true;
  return agora - lastModified <= IDADE_MAXIMA_FOTO_MS;
}

/** Pin de avaria sobre a foto, em % da imagem (0–100). */
export interface MarcadorAvaria {
  x: number;
  y: number;
}
