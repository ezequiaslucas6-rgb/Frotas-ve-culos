'use server';

import { z } from 'zod';
import { calcularCupom, leituraCupomSchema, type CalculoCupom, type RegistroLeitura } from '@/lib/abastecimento/cupom';
import { INSTRUCOES_CUPOM, SCHEMA_CUPOM } from '@/lib/abastecimento/prompt-cupom';
import { requireAdmin, requireSession } from '@/lib/auth';
import { gerarJsonDeImagem, iaConfigurada } from '@/lib/ia/gemini';
import { ErroIA, MENSAGEM_ERRO_IA } from '@/lib/ia/gemini-resposta';
import { criarCache, criarLimitador } from '@/lib/ia/limite';

export type ResultadoLeituraCupom =
  | { ok: true; registro: RegistroLeitura; calculo: CalculoCupom }
  | { ok: false; codigo: string; mensagem: string };

const limitador = criarLimitador({ porMinuto: 6, porDia: 80 });
const limitadorTeste = criarLimitador({ porMinuto: 10, porDia: 150 });
const cache = criarCache<ResultadoLeituraCupom>({ validadeMs: 60 * 60 * 1000, maximo: 300 });

const entrada = z.object({
  veiculoId: z.uuid(),
  // <filial>/<veículo>/cupom-<uuid>.jpg (o nome que o envio da foto do cupom gera)
  caminho: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/cupom-[0-9a-f-]{36}\.jpe?g$/i),
});

const MAX_BYTES = 7 * 1024 * 1024;

/**
 * Lê a foto do cupom (já enviada ao Storage) com o Gemini e devolve os valores calculados.
 * A foto é baixada com a sessão de quem pediu: a mesma regra de acesso do Storage vale aqui.
 */
export async function lerCupom(dados: { veiculoId: string; caminho: string }): Promise<ResultadoLeituraCupom> {
  const session = await requireSession({ motorista: true });
  if (!iaConfigurada()) return { ok: false, codigo: 'sem_chave', mensagem: MENSAGEM_ERRO_IA.sem_chave };
  const parsed = entrada.safeParse(dados);
  if (!parsed.success) return { ok: false, codigo: 'entrada', mensagem: 'Envie a foto do cupom novamente.' };
  const { veiculoId, caminho } = parsed.data;

  // o veículo precisa estar visível para quem pede (RLS) e a foto, na pasta dele
  const { data: veiculo } = await session.supabase.from('veiculos').select('id, filial_id').eq('id', veiculoId).maybeSingle();
  if (!veiculo || !caminho.startsWith(`${veiculo.filial_id}/${veiculo.id}/`)) {
    return { ok: false, codigo: 'entrada', mensagem: 'A foto não é deste veículo. Envie novamente.' };
  }

  const guardado = cache.ler(caminho);
  if (guardado) return guardado;
  if (!limitador.permitir(session.user.id)) {
    return { ok: false, codigo: 'limite_usuario', mensagem: 'Muitas leituras seguidas. Aguarde um minuto ou preencha à mão.' };
  }

  const resultado = await lerDoStorage(session.supabase, caminho);
  if (resultado.ok) cache.guardar(caminho, resultado);
  return resultado;
}

/**
 * Tela de teste (Administrador Geral): lê fotos de modelos de nota sem lançar nada, para
 * conferir se a leitura entende todos os modelos usados. A foto é apagada depois da leitura.
 */
export async function testarLeituraCupom(caminho: string): Promise<ResultadoLeituraCupom> {
  const session = await requireAdmin();
  if (!iaConfigurada()) return { ok: false, codigo: 'sem_chave', mensagem: MENSAGEM_ERRO_IA.sem_chave };
  if (!/^testes-leitura\/[0-9a-f-]{36}\.jpe?g$/i.test(caminho)) return { ok: false, codigo: 'entrada', mensagem: 'Envie a foto novamente.' };
  if (!limitadorTeste.permitir(session.user.id)) {
    return { ok: false, codigo: 'limite_usuario', mensagem: 'Muitas leituras seguidas. Aguarde um minuto.' };
  }
  try {
    return await lerDoStorage(session.supabase, caminho);
  } finally {
    await session.supabase.storage.from('abastecimentos').remove([caminho]);
  }
}

type ClienteSessao = Awaited<ReturnType<typeof requireSession>>['supabase'];

async function lerDoStorage(supabase: ClienteSessao, caminho: string): Promise<ResultadoLeituraCupom> {
  const { data: arquivo, error } = await supabase.storage.from('abastecimentos').download(caminho);
  if (error || !arquivo) return { ok: false, codigo: 'foto', mensagem: 'Não foi possível abrir a foto do cupom. Envie novamente.' };
  if (arquivo.size > MAX_BYTES) return { ok: false, codigo: 'foto', mensagem: 'A foto do cupom é grande demais.' };

  try {
    const { modelo, json } = await gerarJsonDeImagem({
      imagemBase64: Buffer.from(await arquivo.arrayBuffer()).toString('base64'),
      mimeType: 'image/jpeg',
      instrucoes: INSTRUCOES_CUPOM,
      schema: SCHEMA_CUPOM,
    });
    const leitura = leituraCupomSchema.parse(json);
    return {
      ok: true,
      registro: { modelo, lido_em: new Date().toISOString(), leitura },
      calculo: calcularCupom(leitura),
    };
  } catch (e) {
    if (e instanceof ErroIA) {
      if (e.detalhe) console.warn(`[cupom] ${e.codigo}: ${e.detalhe}`);
      return { ok: false, codigo: e.codigo, mensagem: e.message };
    }
    console.error('[cupom] falha na leitura', e);
    return { ok: false, codigo: 'resposta_invalida', mensagem: MENSAGEM_ERRO_IA.resposta_invalida };
  }
}
