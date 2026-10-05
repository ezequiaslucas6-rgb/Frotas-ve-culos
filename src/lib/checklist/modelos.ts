import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { ordenarItens, TIPOS_CHECKLIST, type ItemChecklist, type ModelosChecklist } from './etapas';

const CAMPOS = 'codigo, nome, grupo, instrucao, pergunta, ordem, condicional';

/**
 * Catálogo de itens + o que cada tipo exige (tabelas checklist_itens e checklist_modelo).
 * `catalogo` inclui os itens desativados: o histórico de checklists antigos continua legível.
 * `ativos` são os itens que podem entrar nos modelos.
 */
export async function carregarModelos(supabase: SupabaseClient<Database>): Promise<{
  catalogo: ItemChecklist[];
  ativos: ItemChecklist[];
  modelos: ModelosChecklist;
}> {
  const [{ data: itens }, { data: modelo }] = await Promise.all([
    supabase.from('checklist_itens').select(`${CAMPOS}, ativo`).order('ordem'),
    supabase.from('checklist_modelo').select('tipo, item'),
  ]);
  const ativos = new Map((itens ?? []).filter((i) => i.ativo).map((i) => [i.codigo, i]));
  const modelos = Object.fromEntries(TIPOS_CHECKLIST.map((t) => [t.value, [] as ItemChecklist[]])) as ModelosChecklist;
  for (const m of modelo ?? []) {
    const item = ativos.get(m.item);
    if (item && modelos[m.tipo]) modelos[m.tipo].push(item);
  }
  for (const t of TIPOS_CHECKLIST) modelos[t.value] = ordenarItens(modelos[t.value]);
  const catalogo: ItemChecklist[] = (itens ?? []).map((i) => ({
    codigo: i.codigo,
    nome: i.nome,
    grupo: i.grupo,
    instrucao: i.instrucao,
    pergunta: i.pergunta,
    ordem: i.ordem,
    condicional: i.condicional,
  }));
  return { catalogo, ativos: catalogo.filter((i) => ativos.has(i.codigo)), modelos };
}
