import type { ChecklistDraft } from './types';

const KEY = (userId: string) => `frota:checklist-draft:v1:${userId}`;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Rascunho do checklist no localStorage.
 * Por que existe: ao abrir a câmera, WebViews Android costumam descartar/recarregar a página
 * por falta de memória. As fotos já estão no Storage; aqui guardamos só os metadados para retomar.
 * Todas as operações são tolerantes a falha (modo privado, quota, storage bloqueado).
 */
/** Valor bruto salvo (string estável => serve de snapshot para useSyncExternalStore). */
export function readDraftRaw(userId: string): string | null {
  try {
    return window.localStorage.getItem(KEY(userId));
  } catch {
    return null;
  }
}

/** Rascunho válido (formato conhecido e não expirado) ou null. */
export function parseDraft(raw: string | null): ChecklistDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as ChecklistDraft;
    if (!draft?.checklistId || !draft.etapas || Date.now() - draft.savedAt > MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

/** Notifica mudanças feitas por OUTRAS abas (o evento "storage" não dispara na própria aba). */
export function subscribeDraft(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export function saveDraft(userId: string, draft: ChecklistDraft) {
  try {
    window.localStorage.setItem(KEY(userId), JSON.stringify(draft));
  } catch {
    /* sem persistência: o fluxo continua funcionando normalmente */
  }
}

export function clearDraft(userId: string) {
  try {
    window.localStorage.removeItem(KEY(userId));
  } catch {
    /* noop */
  }
}
