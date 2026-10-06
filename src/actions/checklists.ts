'use server';

import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireAdmin, requireSession } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { TIPOS_CHECKLIST, calcularStatusChecklist, caminhoFotoChecklist, fotosEsperadas, tipoLabel, type ItemChecklist } from '@/lib/checklist/etapas';
import { sincronizarAlertas } from '@/lib/maintenance/sync';
import { checklistSchema } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';

export type SalvarChecklistResult =
  | { ok: true; id: string; status: 'ok' | 'atencao' | 'critico' }
  | { ok: false; message: string };

/**
 * Salva o checklist (as fotos já foram enviadas direto ao Storage pelo browser; aqui chegam
 * só os metadados). Os itens exigidos vêm do modelo do tipo (diário/semanal/mensal):
 *
 *  1. valida o payload (zod) e confere as fotos com o modelo: todos os itens comuns, mais
 *     a foto de vazamento/avaria quando a resposta foi "Sim" (uma foto por item)
 *  2. confere veículo/motorista com a sessão do usuário (RLS) e a mesma filial
 *  3. garante que cada foto está no caminho esperado <filial>/<checklist>/<item>.jpg
 *     e que o arquivo existe no Storage
 *  4. chama a RPC atômica salvar_checklist (que repete a validação do modelo)
 *  5. recalcula os alertas de manutenção do veículo (KM novo pode vencer a revisão)
 */
export async function salvarChecklist(input: unknown): Promise<SalvarChecklistResult> {
  // o motorista também envia: a RLS só aceita os veículos dele e o checklist em seu nome
  const { supabase, isMotorista } = await requireSession({ motorista: true });

  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados do checklist inválidos.' };
  }
  const c = parsed.data;

  const { data: modelo, error: modeloError } = await supabase
    .from('checklist_modelo')
    .select('checklist_itens(codigo, nome, grupo, instrucao, pergunta, ordem, condicional, ativo)')
    .eq('tipo', c.tipo);
  if (modeloError) return { ok: false, message: friendlyDbError(modeloError) };
  const itensModelo = (modelo ?? [])
    .map((m) => m.checklist_itens)
    .filter((i): i is ItemChecklist & { ativo: boolean } => Boolean(i?.ativo));
  if (itensModelo.length === 0) {
    return { ok: false, message: `O checklist ${tipoLabel(c.tipo).toLowerCase()} não tem fotos configuradas.` };
  }

  const semResposta = itensModelo.find((i) => i.condicional && typeof c.respostas[i.codigo] !== 'boolean');
  if (semResposta) return { ok: false, message: `Responda a pergunta "${semResposta.pergunta ?? semResposta.nome}" (Sim ou Não).` };

  const esperados = fotosEsperadas(itensModelo, c.respostas);
  const enviadas = new Set(c.itens.map((i) => i.categoria));
  const faltandoItem = itensModelo.find((i) => esperados.includes(i.codigo) && !enviadas.has(i.codigo));
  if (faltandoItem) return { ok: false, message: `Falta a foto "${faltandoItem.nome}". Volte e fotografe o item.` };
  if (enviadas.size !== c.itens.length || c.itens.some((i) => !esperados.includes(i.categoria))) {
    return { ok: false, message: 'Cada item do checklist deve ter exatamente uma foto. Atualize a página e tente de novo.' };
  }
  const semObservacao = c.itens.find((i) => i.severidade !== 'ok' && !i.observacao);
  if (semObservacao) {
    return { ok: false, message: 'Descreva a inconformidade nos itens marcados como Atenção ou Avaria.' };
  }
  const condicionais = new Set(itensModelo.filter((i) => i.condicional).map((i) => i.codigo));
  if (c.itens.some((i) => condicionais.has(i.categoria) && i.severidade === 'ok')) {
    return { ok: false, message: 'Classifique o vazamento ou a avaria como Atenção ou Avaria.' };
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
    if (item.fotoPath !== caminhoFotoChecklist(veiculo.filial_id, c.checklistId, item.categoria)) {
      return { ok: false, message: 'Caminho de foto inválido. Refaça a captura do item.' };
    }
  }
  const { data: arquivos, error: listError } = await supabase.storage
    .from('checklists')
    .list(`${veiculo.filial_id}/${c.checklistId}`, { limit: 100 });
  if (listError) return { ok: false, message: 'Não foi possível verificar as fotos enviadas.' };
  const enviados = new Set((arquivos ?? []).map((f) => f.name));
  const faltando = c.itens.find((i) => !enviados.has(`${i.categoria}.jpg`));
  if (faltando) {
    const nome = itensModelo.find((i) => i.codigo === faltando.categoria)?.nome ?? faltando.categoria;
    return { ok: false, message: `A foto "${nome}" não foi encontrada. Refaça a captura.` };
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
    p_tipo: c.tipo,
    p_veiculo_id: c.veiculoId,
    p_motorista_id: c.motoristaId,
    p_observacoes: c.observacoesGerais ?? null,
    p_km: c.kmAtual,
    p_fotos: fotos,
    // só as perguntas do modelo (chaves extras seriam ignoradas pela RPC de qualquer forma)
    p_respostas: Object.fromEntries([...condicionais].map((codigo) => [codigo, c.respostas[codigo] === true])),
  });
  if (error) {
    // checklist reenviado (duplo toque / retry de rede): a PK já existe => trata como sucesso idempotente
    if (error.code === '23505') {
      return { ok: true, id: c.checklistId, status: calcularStatusChecklist(c.itens.map((i) => i.severidade)) };
    }
    return { ok: false, message: friendlyDbError(error) };
  }

  // O motorista não grava manutenções: a reavaliação do alerta usa o cliente do servidor
  // (o veículo já foi validado pela RLS acima), como no abastecimento.
  try {
    await sincronizarAlertas(isMotorista ? createAdminClient() : supabase, { veiculoId: veiculo.id });
  } catch (e) {
    console.error('[alertas]', e);
  }

  revalidatePath('/dashboard');
  revalidatePath('/checklists');
  revalidatePath('/checklists/hoje');
  revalidatePath('/veiculos');
  revalidatePath(`/veiculos/${veiculo.id}`);
  revalidatePath('/meu-veiculo');

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

/**
 * Modelos (somente admin): quais itens cada tipo de checklist exige.
 * O formulário envia, para cada tipo, os códigos marcados (name="diario", "semanal", "mensal").
 */
export async function salvarModelosChecklist(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();

  const { data: catalogo, error: catalogoError } = await supabase.from('checklist_itens').select('codigo, condicional').eq('ativo', true);
  if (catalogoError) return fail(friendlyDbError(catalogoError));
  const condicional = new Map((catalogo ?? []).map((i) => [i.codigo, i.condicional]));

  const modelos = TIPOS_CHECKLIST.map((t) => ({
    ...t,
    itens: [...new Set(formData.getAll(t.value).map(String))].filter((codigo) => condicional.has(codigo)),
  }));
  const vazio = modelos.find((m) => !m.itens.some((codigo) => condicional.get(codigo) === false));
  if (vazio) return fail(`O checklist ${vazio.label.toLowerCase()} precisa de ao menos uma foto obrigatória.`);

  for (const m of modelos) {
    const { error } = await supabase.rpc('definir_modelo_checklist', { p_tipo: m.value, p_itens: m.itens });
    if (error) return fail(friendlyDbError(error));
  }

  revalidatePath('/checklists/modelos');
  revalidatePath('/checklists/novo');
  return ok('Modelos de checklist salvos.');
}
