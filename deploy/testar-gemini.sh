#!/usr/bin/env bash
# Testa a leitura pelo Gemini direto do container (mesma chave e mesma rede do app).
#   bash /opt/frotas/deploy/testar-gemini.sh                  # testes rápidos (texto e imagem mínima)
#   bash /opt/frotas/deploy/testar-gemini.sh foto-do-cupom.jpg # também lê uma foto de cupom
# Mostra, por modelo: status, tempo, motivo de término, tokens usados e o começo da resposta.
set -Eeuo pipefail
SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
FOTO="${1:-}"
if [[ -n $FOTO && ! -r $FOTO ]]; then echo "Não consigo ler $FOTO"; exit 1; fi

read -r -d '' JS <<'EOF' || true
const chave = process.env.GEMINI_API_KEY?.trim();
if (!chave) { console.log('GEMINI_API_KEY vazia no .env'); process.exit(1); }
const base = 'https://generativelanguage.googleapis.com/v1beta';
const modelos = [...new Set([...(process.env.GEMINI_MODELOS ?? '').split(',').map((m) => m.trim()).filter(Boolean), 'gemini-flash-latest', 'gemini-flash-lite-latest'])];
const foto = require('fs').readFileSync(0).toString('base64');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const n = (d) => ({ type: 'NUMBER', nullable: true, description: d });
const SCHEMA = { type: 'OBJECT', properties: { litros: n('litros'), valor_total: n('valor total'), desconto: n('desconto'), valor_a_pagar: n('valor a pagar'), posto: { type: 'STRING', nullable: true } }, required: ['litros', 'valor_total', 'desconto', 'valor_a_pagar', 'posto'] };

async function testar(modelo, nome, partes, config) {
  const t = Date.now();
  try {
    const r = await fetch(`${base}/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: config }),
      signal: AbortSignal.timeout(60_000),
    });
    const s = ((Date.now() - t) / 1000).toFixed(1);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return console.log(`  ${nome}: HTTP ${r.status} em ${s} s: ${j.error?.message?.slice(0, 160) ?? ''}`);
    const c = j.candidates?.[0];
    const texto = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
    const u = j.usageMetadata ?? {};
    console.log(`  ${nome}: OK em ${s} s · fim=${c?.finishReason} · versão=${j.modelVersion ?? '?'} · tokens: entrada ${u.promptTokenCount ?? '?'}, raciocínio ${u.thoughtsTokenCount ?? 0}, resposta ${u.candidatesTokenCount ?? '?'}`);
    console.log(`     resposta: ${JSON.stringify(texto.slice(0, 160))}${texto.length > 160 ? ` … (${texto.length} caracteres)` : ''}`);
  } catch (e) {
    console.log(`  ${nome}: SEM RESPOSTA em ${((Date.now() - t) / 1000).toFixed(1)} s (${e.name})`);
  }
}

(async () => {
  const lista = await fetch(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': chave } }).then((r) => r.json()).catch(() => ({}));
  const flash = (lista.models ?? []).map((m) => m.name.replace('models/', '')).filter((m) => /flash/.test(m));
  console.log(`Modelos "flash" desta chave: ${flash.join(', ') || '(não listou)'}\n`);
  for (const modelo of modelos) {
    console.log(`== ${modelo}`);
    await testar(modelo, '1 texto simples', [{ text: 'Responda só: {"ok": true}' }], { responseMimeType: 'application/json', maxOutputTokens: 2048 });
    for (const pensar of [{ thinkingLevel: 'low' }, { thinkingBudget: 0 }]) {
      await testar(modelo, `2 imagem mínima + schema (${Object.entries(pensar)[0].join('=')})`, [{ inline_data: { mime_type: 'image/png', data: PNG } }, { text: 'Transcreva os valores do cupom. Use null no que não aparece.' }], { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 8192, thinkingConfig: pensar });
    }
    if (foto) {
      const img = [{ inline_data: { mime_type: 'image/jpeg', data: foto } }, { text: 'Transcreva os valores deste cupom de abastecimento. Use null no que não aparece.' }];
      await testar(modelo, '3 foto do cupom + schema (thinkingLevel=low)', img, { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } });
      await testar(modelo, '4 foto do cupom, só JSON (sem schema)', img, { responseMimeType: 'application/json', maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } });
    }
    console.log('');
  }
})();
EOF

if [[ -n $FOTO ]]; then
  $SUDO docker exec -i frotas node -e "$JS" < "$FOTO"
else
  $SUDO docker exec -i frotas node -e "$JS" < /dev/null
fi
