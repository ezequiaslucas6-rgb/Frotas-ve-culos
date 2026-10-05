/*
 * Rodar — service worker: o checklist abre e funciona SEM INTERNET.
 *  - guarda a tela /checklists/novo (de quem está logado) e os arquivos que ela usa;
 *  - sem internet, abre a tela guardada; nas outras telas mostra /offline.html;
 *  - as fotos e o envio ficam na fila do aparelho (src/lib/offline/fila.ts) e sobem sozinhos.
 * Nada além disso é guardado (os dados das outras telas sempre vêm do servidor).
 */
const VERSAO = 'v1';
const PAGINAS = `rodar-paginas-${VERSAO}`;
const ESTATICOS = `rodar-estaticos-${VERSAO}`;
const OFFLINE = '/offline.html';
const PAGINAS_OFFLINE = ['/checklists/novo'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(ESTATICOS)
      .then((c) => c.addAll([OFFLINE, '/icons/icon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      for (const chave of await caches.keys()) if (chave !== PAGINAS && chave !== ESTATICOS) await caches.delete(chave);
      await self.clients.claim();
    })(),
  );
});

const ehEstatico = (url) => url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/marca/');
const funcionaOffline = (url) => PAGINAS_OFFLINE.includes(url.pathname);

/** Guarda a página (só se for a tela de verdade, não o login) e os JS/CSS que ela usa. */
async function guardarPagina(url, resposta) {
  if (!resposta.ok || resposta.redirected || resposta.type !== 'basic') return;
  const html = await resposta.clone().text();
  await (await caches.open(PAGINAS)).put(url.pathname, resposta);
  const arquivos = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
  const estaticos = await caches.open(ESTATICOS);
  await Promise.all(
    arquivos.map(async (arquivo) => {
      if (await estaticos.match(arquivo)) return;
      try {
        const r = await fetch(arquivo);
        if (r.ok) await estaticos.put(arquivo, r);
      } catch {
        /* sem rede agora: fica para a próxima */
      }
    }),
  );
}

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // JS/CSS com hash no nome nunca mudam: do cache, se houver
  if (ehEstatico(url)) {
    evento.respondWith(
      caches.match(req).then(
        (guardado) =>
          guardado ||
          fetch(req).then(async (r) => {
            if (r.ok && url.pathname.startsWith('/_next/static/')) (await caches.open(ESTATICOS)).put(req, r.clone());
            return r;
          }),
      ),
    );
    return;
  }

  // telas: sempre da rede; sem internet, a tela guardada (checklist) ou o aviso offline
  if (req.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          const r = await fetch(req);
          if (funcionaOffline(url)) evento.waitUntil(guardarPagina(url, r.clone()));
          return r;
        } catch {
          const guardada = funcionaOffline(url) ? await (await caches.open(PAGINAS)).match(url.pathname) : undefined;
          return guardada || (await caches.match(OFFLINE)) || Response.error();
        }
      })(),
    );
  }
});

/* As mensagens rodam uma de cada vez, na ordem em que chegam: "limpar" e "pré-carregar"
   nunca se cruzam (senão a tela recém-guardada podia ser apagada logo em seguida). */
let fila = Promise.resolve();
const enfileirar = (tarefa) => (fila = fila.then(tarefa).catch(() => undefined));

self.addEventListener('message', (evento) => {
  const dados = evento.data || {};
  if (dados.tipo === 'pre-carregar') {
    evento.waitUntil(
      enfileirar(() =>
        Promise.all(
          (dados.urls || []).filter((u) => PAGINAS_OFFLINE.includes(u)).map(async (u) => {
            try {
              const url = new URL(u, self.location.origin);
              await guardarPagina(url, await fetch(url, { credentials: 'same-origin' }));
            } catch {
              /* sem rede: tenta na próxima abertura */
            }
          }),
        ),
      ),
    );
  }
  // saiu da conta: a tela guardada era de outra pessoa
  if (dados.tipo === 'limpar-paginas') evento.waitUntil(enfileirar(() => caches.delete(PAGINAS)));
});
