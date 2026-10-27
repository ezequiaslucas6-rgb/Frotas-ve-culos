#!/usr/bin/env bash
# =============================================================================
# Divide o Caddyfile em UM ARQUIVO POR SITE (/etc/caddy/sites/<dominio>.caddy).
#
# Por quê: vários projetos/agentes mexem no mesmo Caddyfile. Um que sobrescreva o arquivo inteiro
# derruba TODOS os sites (aconteceu em 26/10 e 27/10/2026). Com um arquivo por site, quem erra só
# estraga o próprio site, e o Caddyfile principal fica quase vazio (só o import), podendo ser
# TRAVADO (chattr +i) para ninguém sobrescrevê-lo.
#
# Uso (como root):
#   sudo bash dividir-caddy.sh --simular      só mostra o que seria feito, sem alterar nada
#   sudo bash dividir-caddy.sh                divide, valida, recarrega e trava o principal
#   sudo bash dividir-caddy.sh --sem-travar   divide, mas não trava o Caddyfile principal
#
# Segurança: o Caddyfile atual precisa estar válido; faz backup (Caddyfile.antes-dividir.*); valida o
# resultado ANTES de trocar; confere que os endereços e destinos (proxy) são os mesmos de antes; se
# qualquer passo falhar, volta ao arquivo original. O Caddy recarrega sem derrubar conexões.
#
# Variáveis (para testes): CADDY_DIR, ARQUIVO, SITES, CADDY_BIN, SERVICO_RELOAD
# =============================================================================
set -Eeuo pipefail

CADDY_DIR="${CADDY_DIR:-/etc/caddy}"
ARQUIVO="${ARQUIVO:-$CADDY_DIR/Caddyfile}"
SITES="${SITES:-$CADDY_DIR/sites}"
CADDY="${CADDY_BIN:-caddy}"
SIMULAR=0
TRAVAR=1

uso() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; }
for a in "$@"; do
  case $a in
    --simular) SIMULAR=1 ;;
    --sem-travar) TRAVAR=0 ;;
    -h | --help) uso; exit 0 ;;
    *) echo "Opção desconhecida: $a" >&2; uso >&2; exit 2 ;;
  esac
done

msg() { printf '\n\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
falha() { printf '\n  \033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || falha "Rode como root: sudo bash $0 $*"
command -v "$CADDY" >/dev/null || falha "Não encontrei o comando caddy."
[[ -f $ARQUIVO ]] || falha "Não encontrei $ARQUIVO."

recarregar() {
  if [[ -n ${SERVICO_RELOAD:-} ]]; then
    bash -c "$SERVICO_RELOAD"
  elif systemctl is-active -q caddy 2>/dev/null; then
    systemctl reload caddy
  else
    "$CADDY" reload --config "$ARQUIVO" --adapter caddyfile
  fi
}

TMP="$(mktemp -d /tmp/dividir-caddy.XXXXXX)"
validar() { "$CADDY" validate --config "$1" --adapter caddyfile >"$TMP/validate.log" 2>&1; }

# ----------------------------------------------------------------------------- caminho único de "voltar atrás"
# ETAPA: ""          nada alterado ainda
#        instalando  backup feito, arquivos novos sendo colocados (o Caddy ainda roda o original)
#        trocado     Caddyfile novo no lugar (o Caddy pode já ter carregado: recarrega o original ao voltar)
#        concluido   tudo certo
ETAPA=""
BACKUP=""
TRAVADO=0
reverter() {
  aviso "Voltando ao Caddyfile original"
  rm -f "$ARQUIVO.novo"
  cp -a "$BACKUP" "$ARQUIVO"
  rm -rf "$SITES"
  [[ $ETAPA == trocado ]] && { recarregar >/dev/null 2>&1 || aviso "Recarregue o Caddy à mão: sudo systemctl reload caddy"; }
  if ((TRAVADO)); then chattr +i "$ARQUIVO" 2>/dev/null || true; fi
}
saida() {
  local rc=$?
  if ((rc != 0)) && [[ -n $ETAPA && $ETAPA != concluido ]]; then reverter; fi
  rm -rf "$TMP"
  exit $rc
}
trap saida EXIT

# ----------------------------------------------------------------------------- 1. confere o ponto de partida
msg "Conferindo o Caddyfile atual ($ARQUIVO)"
validar "$ARQUIVO" || {
  cat "$TMP/validate.log" >&2
  falha "O Caddyfile atual já está inválido: corrija ou restaure um backup antes de dividir (nada foi alterado)."
}
ok "Configuração atual válida"
if [[ -d $SITES ]] && [[ -n $(ls -A "$SITES" 2>/dev/null) ]]; then
  falha "$SITES já existe e não está vazia: a divisão parece já ter sido feita (nada foi alterado)."
fi

# ----------------------------------------------------------------------------- 2. divide (em pasta temporária)
msg "Separando os sites"
mkdir -p "$TMP/sites"
awk -v destino="$TMP/sites" -v principal="$TMP/principal" -v lista="$TMP/enderecos" '
  # tira comentário e {placeholders} de uma linha, para contar só as chaves de bloco
  function limpa(l,   t) {
    t = l
    sub(/(^|[ \t])#.*/, "", t)
    gsub(/\{[^{}]*\}/, "", t)
    return t
  }
  function saldo(l,   t, a, b) {
    t = limpa(l); a = gsub(/\{/, "{", t); b = gsub(/\}/, "}", t)
    return a - b
  }
  function nome_arquivo(cabecalho,   h, p, n) {
    h = cabecalho; sub(/[ \t]*\{[ \t]*(#.*)?$/, "", h)
    split(h, p, /[ \t,]+/); n = p[1]
    sub(/^https?:\/\//, "", n)
    if (n ~ /^\{/) { gsub(/[{}$]/, "", n); n = "var-" n }      # endereço por variável: {$DOMINIO} -> var-DOMINIO
    gsub(/[^A-Za-z0-9._-]/, "_", n)
    if (n == "" || n ~ /^_+$/) n = "site"
    usados[n]++
    return (usados[n] > 1) ? n "-" usados[n] : n
  }
  BEGIN { prof = 0; alvo = ""; pend = "" }
  {
    linha = $0
    if (prof == 0) {
      if (linha ~ /^[ \t]*(#.*)?$/) { pend = pend linha "\n"; next }          # comentário/linha em branco: acompanha o próximo bloco
      if (linha ~ /^\{[ \t]*(#.*)?$/ || linha ~ /^\([^)]+\)[ \t]*\{/ || linha ~ /^import[ \t]/) {   # opções globais, snippet ou import: ficam no principal
        printf "%s%s\n", pend, linha >> principal; pend = ""; alvo = principal
      } else if (linha ~ /^[^ \t#}][^#]*\{[ \t]*(#.*)?$/ || linha ~ /^[^ \t#}][^#]*\{.*\}[ \t]*$/) {   # site
        cab = linha; n = nome_arquivo(cab); alvo = destino "/" n ".caddy"
        h = cab; sub(/[ \t]*\{[ \t]*(#.*)?$/, "", h); print h >> lista
        printf "%s%s\n", pend, linha >> alvo; pend = ""
      } else {
        print "formato não reconhecido na linha " NR ": " linha > "/dev/stderr"; exit 3
      }
      prof += saldo(linha)
      if (prof == 0) { close(alvo); alvo = "" }
      next
    }
    print linha >> alvo
    prof += saldo(linha)
    if (prof < 0) { print "chave fechada a mais na linha " NR > "/dev/stderr"; exit 3 }
    if (prof == 0) { close(alvo); alvo = "" }
  }
  END {
    if (prof != 0) { print "chaves desbalanceadas (bloco aberto no fim do arquivo)" > "/dev/stderr"; exit 3 }
    if (pend != "") printf "%s", pend >> principal
  }
' "$ARQUIVO" || falha "Não consegui separar este Caddyfile automaticamente (nada foi alterado). Divida à mão ou me envie o arquivo."

SITES_NOVOS=$(find "$TMP/sites" -name '*.caddy' | sort)
[[ -n $SITES_NOVOS ]] || falha "Não encontrei nenhum site no Caddyfile (nada foi alterado)."
ok "$(wc -l <<<"$SITES_NOVOS") site(s):"
while read -r f; do printf '      %-62s %s linhas\n' "sites/$(basename "$f")" "$(wc -l <"$f")"; done <<<"$SITES_NOVOS"

# o Caddyfile principal: o que sobrou (opções globais, snippets) + o import
{
  cat <<'CABECALHO'
# Caddyfile PRINCIPAL: NÃO coloque sites aqui.
# Cada site tem o seu próprio arquivo em /etc/caddy/sites/ (um arquivo por domínio).
# Quem cuida de um site edita SÓ o arquivo dele, assim ninguém derruba os sites dos outros.
# Depois de mexer: sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy
CABECALHO
  if [[ -s $TMP/principal ]]; then echo; cat "$TMP/principal"; fi
  echo
  echo "import $SITES/*.caddy"
} >"$TMP/Caddyfile.novo"

if ((SIMULAR)); then
  msg "SIMULAÇÃO (nada foi alterado). O Caddyfile principal ficaria assim:"
  sed 's/^/      /' "$TMP/Caddyfile.novo"
  msg "Para aplicar: sudo bash $0"
  exit 0
fi

# ----------------------------------------------------------------------------- 3. backup e instalação lado a lado
msg "Backup e validação do resultado"
BACKUP="$ARQUIVO.antes-dividir.$(date +%Y%m%d%H%M%S)"
cp -a "$ARQUIVO" "$BACKUP"
ok "Backup: $BACKUP"

if command -v lsattr >/dev/null && lsattr -d "$ARQUIVO" 2>/dev/null | awk '{print $1}' | grep -q i; then
  TRAVADO=1
  chattr -i "$ARQUIVO"
  aviso "O Caddyfile estava travado (chattr +i): destravado só durante a divisão"
fi

ETAPA=instalando
mkdir -p "$SITES"
cp -a "$TMP/sites/." "$SITES/"
chmod 755 "$SITES"
chmod 644 "$SITES"/*.caddy
cp "$TMP/Caddyfile.novo" "$ARQUIVO.novo"
chmod 644 "$ARQUIVO.novo"

if ! validar "$ARQUIVO.novo"; then
  cat "$TMP/validate.log" >&2
  falha "A configuração dividida ficou inválida (nada mudou; o original continua no lugar)."
fi
ok "Configuração dividida válida"

# confere que o Caddy enxerga os mesmos endereços e destinos (proxy) de antes
resumo() { "$CADDY" adapt --config "$1" --adapter caddyfile 2>/dev/null | grep -oE '"(host|dial)":(\["[^]]*\]|"[^"]*")' | sort -u || true; }
resumo "$BACKUP" >"$TMP/antes.txt"
resumo "$ARQUIVO.novo" >"$TMP/depois.txt"
if ! diff -q "$TMP/antes.txt" "$TMP/depois.txt" >/dev/null; then
  diff "$TMP/antes.txt" "$TMP/depois.txt" >&2 || true
  falha "Os sites ou destinos mudariam com a divisão (nada mudou; o original continua no lugar)."
fi
if [[ -s $TMP/antes.txt ]]; then
  ok "Mesmos endereços e destinos de antes ($(wc -l <"$TMP/antes.txt") itens conferidos)"
else
  aviso "Não consegui comparar os endereços (o 'caddy adapt' não devolveu nada); a validação passou."
fi

# ----------------------------------------------------------------------------- 4. troca e recarrega
msg "Aplicando"
mv "$ARQUIVO.novo" "$ARQUIVO"
ETAPA=trocado
if ! recarregar >"$TMP/reload.log" 2>&1; then
  cat "$TMP/reload.log" >&2
  falha "O Caddy não recarregou a nova configuração: voltei ao original (backup: $BACKUP)."
fi
ok "Caddy recarregado"
ETAPA=concluido

if ((TRAVAR || TRAVADO)) && command -v chattr >/dev/null; then
  if chattr +i "$ARQUIVO" 2>/dev/null; then
    ok "Caddyfile principal TRAVADO (chattr +i): ninguém o sobrescreve; os sites em $SITES continuam editáveis"
  else
    aviso "Não consegui travar o Caddyfile (sistema de arquivos sem suporte a chattr)"
  fi
fi

msg "Pronto"
cat <<FIM

  Cada site agora tem o seu arquivo:  $SITES/<dominio>.caddy
  - Alterar ou adicionar um site: edite ou crie SÓ o arquivo dele, depois
        sudo caddy validate --config $ARQUIVO --adapter caddyfile && sudo systemctl reload caddy
  - Mexer no Caddyfile principal (raro): sudo chattr -i $ARQUIVO ...edite... sudo chattr +i $ARQUIVO
  - Voltar ao arquivo único: sudo chattr -i $ARQUIVO; sudo cp -a $BACKUP $ARQUIVO; sudo rm -rf $SITES; sudo systemctl reload caddy

  Teste agora cada site no navegador.
FIM
