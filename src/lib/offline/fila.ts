/**
 * Checklist sem sinal: fila no próprio aparelho (IndexedDB), só no navegador.
 *
 *  - fotos:  cada foto tirada no checklist fica guardada aqui (comprimida) até o checklist
 *            ser enviado. Se a internet cair, a foto sobe depois.
 *  - envios: o checklist completo, quando "Enviar" é tocado sem internet (ou com fotos
 *            ainda no aparelho). É enviado sozinho quando a internet volta (em qualquer tela
 *            do app aberta, ou na próxima vez que o app abrir).
 *
 * Tudo é tolerante a falha: se o IndexedDB não existir (modo privado antigo), o checklist
 * continua funcionando online como antes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const BANCO = 'rodar-offline';
const VERSAO = 1;
/** Disparado a cada mudança na fila (o indicador de pendências escuta). */
export const EVENTO_FILA = 'rodar:fila';

export interface FotoLocal {
  /** caminho no bucket "checklists": <filial>/<checklist>/<item>.jpg */
  path: string;
  checklistId: string;
  userId: string;
  blob: Blob;
  enviada: boolean;
  criadaEm: number;
}

export interface EnvioPendente {
  checklistId: string;
  userId: string;
  /** para mostrar ao usuário ("Checklist ABC1D23") */
  placa: string;
  /** o mesmo objeto que a action salvarChecklist recebe */
  payload: { itens: Array<{ fotoPath: string }> } & Record<string, unknown>;
  criadoEm: number;
  /** recusado pelo servidor (ex.: KM menor que o último): não tenta de novo sozinho */
  erro?: string;
}

let conexao: Promise<IDBDatabase> | null = null;
function abrir(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB indisponível'));
  conexao ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('fotos')) {
        db.createObjectStore('fotos', { keyPath: 'path' }).createIndex('checklistId', 'checklistId');
      }
      if (!db.objectStoreNames.contains('envios')) db.createObjectStore('envios', { keyPath: 'checklistId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      conexao = null;
      reject(req.error);
    };
  });
  return conexao;
}

function operar<T>(loja: 'fotos' | 'envios', modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(loja, modo);
        const req = fn(tx.objectStore(loja));
        tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

const avisar = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_FILA));
};

/* ------------------------------ fotos ------------------------------ */

export async function guardarFoto(foto: Omit<FotoLocal, 'enviada' | 'criadaEm'>): Promise<boolean> {
  try {
    await operar('fotos', 'readwrite', (s) => s.put({ ...foto, enviada: false, criadaEm: Date.now() } satisfies FotoLocal));
    return true;
  } catch {
    return false;
  }
}

export const lerFoto = (path: string) =>
  operar<FotoLocal | undefined>('fotos', 'readonly', (s) => s.get(path)).catch(() => undefined);

export const fotosDoChecklist = (checklistId: string) =>
  operar<FotoLocal[]>('fotos', 'readonly', (s) => s.index('checklistId').getAll(checklistId)).catch(() => [] as FotoLocal[]);

export const todasAsFotos = () => operar<FotoLocal[]>('fotos', 'readonly', (s) => s.getAll()).catch(() => [] as FotoLocal[]);

export async function marcarFotoEnviada(path: string) {
  const foto = await lerFoto(path);
  if (foto && !foto.enviada) await operar('fotos', 'readwrite', (s) => s.put({ ...foto, enviada: true })).catch(() => undefined);
}

export async function apagarFotosDoChecklist(checklistId: string) {
  const fotos = await fotosDoChecklist(checklistId);
  if (fotos.length) {
    await operar('fotos', 'readwrite', (s) => {
      for (const f of fotos) s.delete(f.path);
    }).catch(() => undefined);
  }
}

/* ------------------------------ envios ------------------------------ */

export async function guardarEnvio(envio: Omit<EnvioPendente, 'criadoEm'>): Promise<boolean> {
  try {
    await operar('envios', 'readwrite', (s) => s.put({ ...envio, criadoEm: Date.now() } satisfies EnvioPendente));
    avisar();
    return true;
  } catch {
    return false;
  }
}

export const listarEnvios = (userId: string) =>
  operar<EnvioPendente[]>('envios', 'readonly', (s) => s.getAll())
    .then((lista) => lista.filter((e) => e.userId === userId).sort((a, b) => a.criadoEm - b.criadoEm))
    .catch(() => [] as EnvioPendente[]);

export async function apagarEnvio(checklistId: string) {
  await operar('envios', 'readwrite', (s) => s.delete(checklistId)).catch(() => undefined);
  await apagarFotosDoChecklist(checklistId);
  avisar();
}

async function marcarErro(envio: EnvioPendente, erro: string) {
  await operar('envios', 'readwrite', (s) => s.put({ ...envio, erro })).catch(() => undefined);
  avisar();
}

/* ------------------------------ envio de fato ------------------------------ */

/** O aparelho diz que está sem internet (se não souber dizer, tenta). */
const semInternet = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Falha de rede (ou servidor fora do ar) => esperar a internet; recusa (4xx) => mostrar o motivo. */
export const ehFalhaDeRede = (erro: unknown) => {
  const status = Number((erro as { status?: unknown; statusCode?: unknown } | null)?.status ?? (erro as { statusCode?: unknown } | null)?.statusCode);
  return semInternet() || !Number.isFinite(status) || status === 0 || status >= 500;
};

/** Sobe uma foto da fila (upsert no mesmo caminho). */
export async function subirFoto(supabase: SupabaseClient<Database>, foto: FotoLocal): Promise<'ok' | 'rede' | 'recusada'> {
  if (foto.enviada) return 'ok';
  if (semInternet()) return 'rede';
  const { error } = await supabase.storage
    .from('checklists')
    .upload(foto.path, foto.blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (!error) {
    await marcarFotoEnviada(foto.path);
    return 'ok';
  }
  return ehFalhaDeRede(error) ? 'rede' : 'recusada';
}

export type ResultadoEnvio =
  | { estado: 'enviado'; id: string; status: 'ok' | 'atencao' | 'critico' }
  | { estado: 'aguardando' }
  | { estado: 'recusado'; mensagem: string };

type Salvar = (input: unknown) => Promise<{ ok: true; id: string; status: 'ok' | 'atencao' | 'critico' } | { ok: false; message: string }>;

const emAndamento = new Set<string>();

/**
 * Sobe as fotos que ainda estão no aparelho e envia o checklist. Idempotente: reenviar o
 * mesmo checklist não duplica (a RPC trata o id repetido como sucesso).
 *   - sem internet / servidor fora: 'aguardando' (fica na fila)
 *   - recusado pelo servidor: 'recusado' (marcado com o erro, não tenta sozinho de novo)
 *   - enviado: sai da fila e as fotos locais são apagadas
 */
export async function processarEnvio(envio: EnvioPendente, supabase: SupabaseClient<Database>, salvar: Salvar): Promise<ResultadoEnvio> {
  if (emAndamento.has(envio.checklistId)) return { estado: 'aguardando' };
  emAndamento.add(envio.checklistId);
  try {
    const locais = new Map((await fotosDoChecklist(envio.checklistId)).map((f) => [f.path, f]));
    for (const item of envio.payload.itens) {
      const foto = locais.get(item.fotoPath);
      if (!foto) continue; // já estava no servidor (subiu na hora)
      const r = await subirFoto(supabase, foto);
      if (r === 'rede') return { estado: 'aguardando' };
      if (r === 'recusada') {
        const mensagem = 'Não foi possível enviar uma das fotos. Refaça o checklist.';
        await marcarErro(envio, mensagem);
        return { estado: 'recusado', mensagem };
      }
    }

    let resultado: Awaited<ReturnType<Salvar>>;
    try {
      resultado = await salvar(envio.payload);
    } catch {
      return { estado: 'aguardando' }; // sem rede, servidor fora ou versão nova do app no ar
    }
    if (resultado.ok) {
      await apagarEnvio(envio.checklistId);
      return { estado: 'enviado', id: resultado.id, status: resultado.status };
    }
    await marcarErro(envio, resultado.message);
    return { estado: 'recusado', mensagem: resultado.message };
  } finally {
    emAndamento.delete(envio.checklistId);
  }
}
