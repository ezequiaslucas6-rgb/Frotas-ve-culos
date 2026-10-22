import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { carregarNotificacoes, momentoDoPapel, type EscopoLembrete } from '@/lib/checklist/lembretes-servidor';
import type { Momento, Notificacao } from '@/lib/checklist/lembretes';
import { toISODate } from '@/lib/dates';
import type { Database } from '@/types/database';
import { enviarParaAlvos, type Alvo } from './enviar';

type Client = SupabaseClient<Database>;

/** Um disparo travado (servidor caiu no meio) pode ser retomado depois disto. */
const RETOMAR_APOS_MS = 3 * 60 * 1000;
const EM_PARALELO = 8;

export interface ResumoDisparo {
  momento: Momento;
  usuarios: number;
  notificacoes: number;
  enviados: number;
  removidos: number;
  falhas: number;
}

/**
 * Reserva o disparo de `momento` no dia: só UM processo envia (o agendador roda todo minuto).
 * Devolve false se já foi enviado, ou se outro processo está enviando agora.
 */
export async function reservarDisparo(supabase: Client, momento: Momento, dia: string, agora = Date.now()): Promise<boolean> {
  const { data: novo } = await supabase
    .from('push_disparos')
    .upsert({ momento, dia, iniciado_em: new Date(agora).toISOString() }, { onConflict: 'momento,dia', ignoreDuplicates: true })
    .select('momento');
  if (novo?.length) return true;

  const { data: atual } = await supabase.from('push_disparos').select('iniciado_em, concluido_em').eq('momento', momento).eq('dia', dia).maybeSingle();
  if (!atual || atual.concluido_em) return false;
  if (agora - new Date(atual.iniciado_em).getTime() < RETOMAR_APOS_MS) return false;
  // travado: retoma só se ninguém mais retomou (compara o início que lemos)
  const { data: retomado } = await supabase
    .from('push_disparos')
    .update({ iniciado_em: new Date(agora).toISOString() })
    .eq('momento', momento)
    .eq('dia', dia)
    .eq('iniciado_em', atual.iniciado_em)
    .is('concluido_em', null)
    .select('momento');
  return Boolean(retomado?.length);
}

/** Todos os aparelhos cadastrados, agrupados por usuário. */
async function aparelhosPorUsuario(supabase: Client): Promise<Map<string, Alvo[]>> {
  const mapa = new Map<string, Alvo[]>();
  for (let de = 0; ; de += 1000) {
    const { data } = await supabase.from('push_dispositivos').select('id, user_id, tipo, destino, chave_p256dh, chave_auth').range(de, de + 999);
    for (const d of data ?? []) mapa.set(d.user_id, [...(mapa.get(d.user_id) ?? []), d]);
    if ((data?.length ?? 0) < 1000) break;
  }
  return mapa;
}

/** Quem recebe em `momento` e com que escopo (motorista inativo e papel de outro horário ficam de fora). */
async function escoposDoMomento(supabase: Client, userIds: string[], momento: Momento): Promise<Map<string, EscopoLembrete>> {
  const escopos = new Map<string, EscopoLembrete>();
  if (!userIds.length) return escopos;
  const [{ data: perfis }, { data: motoristas }] = await Promise.all([
    supabase.from('profiles').select('id, role, filial_id').in('id', userIds),
    supabase.from('motoristas').select('id, user_id, status, dias_folga').in('user_id', userIds),
  ]);
  for (const p of perfis ?? []) {
    if (p.role === 'motorista') {
      const m = (motoristas ?? []).find((x) => x.user_id === p.id);
      if (m && m.status !== 'inativo') escopos.set(p.id, { papel: 'motorista', motoristaId: m.id, diasFolga: m.dias_folga });
    } else if (p.role === 'supervisor' && p.filial_id) {
      escopos.set(p.id, { papel: 'supervisor', filialId: p.filial_id });
    } else if (p.role === 'admin') {
      escopos.set(p.id, { papel: 'admin' });
    }
  }
  for (const [id, e] of escopos) if (momentoDoPapel(e.papel) !== momento) escopos.delete(id);
  return escopos;
}

/** Envia o lembrete de `momento` a todos os aparelhos que devem recebê-lo. */
export async function dispararLembretes(supabase: Client, momento: Momento, agora = new Date()): Promise<ResumoDisparo> {
  const aparelhos = await aparelhosPorUsuario(supabase);
  const escopos = await escoposDoMomento(supabase, [...aparelhos.keys()], momento);
  const resumo: ResumoDisparo = { momento, usuarios: escopos.size, notificacoes: 0, enviados: 0, removidos: 0, falhas: 0 };

  // supervisores da mesma filial (e admins) recebem o mesmo resumo: calcula uma vez
  const cache = new Map<string, Promise<Notificacao[]>>();
  const doEscopo = (e: EscopoLembrete) => {
    const chave = e.papel === 'supervisor' ? `s:${e.filialId}` : e.papel === 'admin' ? 'admin' : `m:${e.motoristaId}`;
    if (!cache.has(chave)) cache.set(chave, carregarNotificacoes(supabase, e, momento, agora));
    return cache.get(chave)!;
  };

  const fila = [...escopos];
  const trabalhador = async () => {
    for (let item = fila.shift(); item; item = fila.shift()) {
      const [userId, escopo] = item;
      try {
        for (const n of await doEscopo(escopo)) {
          const r = await enviarParaAlvos(supabase, aparelhos.get(userId) ?? [], n);
          resumo.notificacoes++;
          resumo.enviados += r.enviados;
          resumo.removidos += r.removidos;
          resumo.falhas += r.falhas;
        }
      } catch (e) {
        resumo.falhas++;
        console.error('[push/disparar]', userId, e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EM_PARALELO, fila.length) }, trabalhador));

  await supabase
    .from('push_disparos')
    .update({ concluido_em: new Date().toISOString(), enviados: resumo.enviados })
    .eq('momento', momento)
    .eq('dia', toISODate(agora));
  return resumo;
}
