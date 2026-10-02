'use server';

import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin, requireSession } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { CHECKLIST_ETAPAS, calcularStatusChecklist, caminhoFotoChecklist, type CategoriaFoto } from '@/lib/checklist/etapas';
import { sincronizarAlertas } from '@/lib/maintenance/sync';
import { checklistSchema } from '@/lib/schemas';
import type { Json } from '@/types/database';

export type SalvarChecklistResult =
  | { ok: true; id: string; status: 'ok' | 'atencao' | 'critico' }
  | { ok: false; message: string };

/**
 * Salva o checklist de 14 etapas (as fotos já foram enviadas direto ao Storage pelo
 * browser; aqui chegam só os metadados).
 *
 *  1. valida o payload (zod) e que as 14 categorias vieram exatamente uma vez
 *  2. confere veículo/motorista com a sessão do usuário (RLS) e a mesma filial
 *  3. garante que cada foto está no caminho esperado <filial>/<checklist>/<categoria>.jpg
 *     e que o arquivo existe no Storage
 *  4. chama a RPC atômica salvar_checklist (checklist + fotos + KM do veículo)
 *  5. recalcula os alertas de manutenção do veículo (KM novo pode vencer a revisão)
 */
export async function salvarChecklist(input: unknown): Promise<SalvarChecklistResult> {
  const { supabase } = await requireSession();

  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados do checklist inválidos.' };
  }
  const c = parsed.data;

  const categorias = new Set(c.itens.map((i) => i.categoria));
  if (categorias.size !== CHECKLIST_ETAPAS.length) {
    return { ok: false, message: 'Cada etapa do checklist deve ter exatamente uma foto.' };
  }
  const semObservacao = c.itens.find((i) => i.severidade !== 'ok' && !i.observacao);
  if (semObservacao) {
    return { ok: false, message: 'Descreva a inconformidade nos itens marcados como Atenção ou Avaria.' };
  }

  const [{ data: veiculo }, { data: motorista }] = await Promise.all([
    supabase.from('veiculos').select('id, filial_id, km_atual').eq('id', c.veiculoId).maybeSingle(),
    supabase.from('motoristas').select('id, filial_id, status').eq('id', c.motoristaId).maybeSingle(),
  ]);
  if (!veiculo) return { ok: false, message: 'Veículo não encontrado.' };
  if (!motorista) return { ok: false, message: 'Motorista não encontrado.' };
  if (motorista.filial_id !== veiculo.filial_id) {
    return { ok: false, message: 'O motorista e o veículo pertencem a filiais diferentes.' };
  }
  if (motorista.status !== 'ativo') {
    return { ok: false, message: 'O motorista selecionado não está ativo.' };
  }
  if (c.kmAtual < veiculo.km_atual) {
    return { ok: false, message: `O KM informado é menor que o último registrado (${veiculo.km_atual} km).` };
  }

  // 3. caminhos esperados + existência no Storage
  for (const item of c.itens) {
    if (item.fotoPath !== caminhoFotoChecklist(veiculo.filial_id, c.checklistId, item.categoria as CategoriaFoto)) {
      return { ok: false, message: 'Caminho de foto inválido. Refaça a captura da etapa.' };
    }
  }
  const { data: arquivos, error: listError } = await supabase.storage
    .from('checklists')
    .list(`${veiculo.filial_id}/${c.checklistId}`, { limit: 100 });
  if (listError) return { ok: false, message: 'Não foi possível verificar as fotos enviadas.' };
  const enviados = new Set((arquivos ?? []).map((f) => f.name));
  const faltando = c.itens.find((i) => !enviados.has(`${i.categoria}.jpg`));
  if (faltando) {
    const titulo = CHECKLIST_ETAPAS.find((e) => e.categoria === faltando.categoria)?.titulo ?? faltando.categoria;
    return { ok: false, message: `A foto da etapa "${titulo}" não foi encontrada. Refaça a captura.` };
  }

  const fotos: Json = c.itens.map((i) => ({
    categoria_foto: i.categoria,
    foto_url: i.fotoPath,
    severidade: i.severidade,
    observacao: i.severidade === 'ok' ? null : (i.observacao ?? null),
    marcadores: i.marcadores,
  }));

  const { error } = await supabase.rpc('salvar_checklist', {
    p_id: c.checklistId,
    p_veiculo_id: c.veiculoId,
    p_motorista_id: c.motoristaId,
    p_observacoes: c.observacoesGerais ?? null,
    p_km: c.kmAtual,
    p_fotos: fotos,
  });
  if (error) {
    // checklist reenviado (duplo toque / retry de rede): a PK já existe => trata como sucesso idempotente
    if (error.code === '23505') {
      return { ok: true, id: c.checklistId, status: calcularStatusChecklist(c.itens.map((i) => i.severidade)) };
    }
    return { ok: false, message: friendlyDbError(error) };
  }

  await sincronizarAlertas(supabase, { veiculoId: veiculo.id }).catch((e) => console.error('[alertas]', e));

  revalidatePath('/dashboard');
  revalidatePath('/checklists');
  revalidatePath(`/veiculos/${veiculo.id}`);

  return { ok: true, id: c.checklistId, status: calcularStatusChecklist(c.itens.map((i) => i.severidade)) };
}

/** Exclusão (somente admin): remove as fotos do Storage e o checklist (fotos em cascata). */
export async function excluirChecklist(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('id') ?? '');

  const { data: fotos } = await supabase.from('checklist_fotos').select('foto_url').eq('checklist_id', id);
  const { error, count } = await supabase.from('checklists').delete({ count: 'exact' }).eq('id', id);
  if (error) return fail(friendlyDbError(error));
  if (!count) return fail('Checklist não encontrado.');

  const paths = (fotos ?? []).map((f) => f.foto_url);
  if (paths.length) await supabase.storage.from('checklists').remove(paths);

  revalidatePath('/checklists');
  revalidatePath('/dashboard');
  return ok('Checklist excluído.');
}
