#!/usr/bin/env bash
# Testa o trecho do Caddy do deploy/instalar-vps.sh (extraído do próprio instalador) com um "caddy" de mentirinha.
#   bash deploy/testes/instalar-caddy.test.sh
set -Eeuo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
INST="$AQUI/../instalar-vps.sh"
RAIZ="$(mktemp -d /tmp/teste-instalar-caddy.XXXXXX)"
trap 'rm -rf "$RAIZ"' EXIT
FALHAS=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
ruim() { printf '  \033[31m✗ %s\033[0m\n' "$*"; FALHAS=$((FALHAS + 1)); }
confere() { if eval "$2"; then ok "$1"; else ruim "$1   [$2]"; fi; }

# caddy/lsattr de mentirinha (os mesmos do teste de divisão, reaproveitados)
mkdir -p "$RAIZ/bin"
sed -n "/^cat >\"\$RAIZ\/bin\/caddy\" <<'STUB'/,/^STUB/p" "$AQUI/dividir-caddy.test.sh" | sed '1d;$d' >"$RAIZ/bin/caddy"
sed -n "/^cat >\"\$RAIZ\/bin\/lsattr\" <<'STUB'/,/^STUB/p" "$AQUI/dividir-caddy.test.sh" | sed '1d;$d' >"$RAIZ/bin/lsattr"
chmod +x "$RAIZ/bin/caddy" "$RAIZ/bin/lsattr"
export PATH="$RAIZ/bin:$PATH"

# o trecho a testar: da 1ª condição depois de "identifiquei o Caddyfile" até o fim da cadeia if/elif
INI=$(grep -n 'elif \$SUDO grep -qs "\^\$DOMINIO {" "\$CONFIG_WEB"' "$INST" | head -1 | cut -d: -f1)
FIM=$(awk -v ini="$INI" 'NR>ini && /^    fi$/ {print NR; exit}' "$INST")
[[ -n $INI && -n $FIM ]] || { echo "não achei o trecho do Caddy no instalador"; exit 1; }
sed -n "${INI},$((FIM - 1))p" "$INST" >"$RAIZ/trecho.sh"

roda() { # $1 = pasta do cenário
  D="$RAIZ/$1"
  cat >"$RAIZ/harness.sh" <<HARNESS
set -Eeuo pipefail
ok() { echo "OK: \$*"; }; aviso() { echo "AVISO: \$*"; }; falha() { echo "FALHA: \$*"; exit 1; }
SUDO=""; DOMINIO=frotas.209.50.240.59.sslip.io; PORTA=3010; CONFIG_WEB="$D/Caddyfile"
if false; then :
$(cat "$RAIZ/trecho.sh")
fi
echo "CONFIG_WEB=[\$CONFIG_WEB]"
HARNESS
  set +e; bash "$RAIZ/harness.sh" >"$D/saida.txt" 2>&1; RC=$?; set -e
}

OUTRO='nortetel-cursos.com.br {
	reverse_proxy 127.0.0.1:3000
}'
FROTAS='frotas.209.50.240.59.sslip.io {
	reverse_proxy 127.0.0.1:3010
}'

echo "1) arquivo único que já tem o Frotas: não faz nada"
mkdir -p "$RAIZ/c1" && printf '%s\n%s\n' "$OUTRO" "$FROTAS" >"$RAIZ/c1/Caddyfile"; cp "$RAIZ/c1/Caddyfile" "$RAIZ/c1/orig"
roda c1
confere "reconhece que já está configurado" '[[ $RC -eq 0 ]] && grep -q "já configurado" "$D/saida.txt" && cmp -s "$D/Caddyfile" "$D/orig"'

echo "2) estrutura dividida que já tem o arquivo do Frotas em sites/: não faz nada"
mkdir -p "$RAIZ/c2/sites" && printf 'import %s/sites/*.caddy\n' "$RAIZ/c2" >"$RAIZ/c2/Caddyfile"; printf '%s\n' "$OUTRO" >"$RAIZ/c2/sites/nortetel-cursos.com.br.caddy"; printf '%s\n' "$FROTAS" >"$RAIZ/c2/sites/frotas.209.50.240.59.sslip.io.caddy"
roda c2
confere "reconhece e não duplica" '[[ $RC -eq 0 ]] && grep -q "já configurado" "$D/saida.txt" && [[ $(ls "$D/sites" | wc -l) -eq 2 ]]'

echo "3) estrutura dividida SEM o Frotas: cria só o arquivo dele"
mkdir -p "$RAIZ/c3/sites" && printf 'import %s/sites/*.caddy\n' "$RAIZ/c3" >"$RAIZ/c3/Caddyfile"; printf '%s\n' "$OUTRO" >"$RAIZ/c3/sites/nortetel-cursos.com.br.caddy"; cp "$RAIZ/c3/Caddyfile" "$RAIZ/c3/orig"
roda c3
confere "criou sites/frotas...caddy válido e não tocou no principal" '[[ $RC -eq 0 ]] && [[ -f "$D/sites/frotas.209.50.240.59.sslip.io.caddy" ]] && grep -q "reverse_proxy 127.0.0.1:3010" "$D/sites/frotas.209.50.240.59.sslip.io.caddy" && cmp -s "$D/Caddyfile" "$D/orig"'
confere "o arquivo do outro site ficou intacto" 'grep -q "127.0.0.1:3000" "$D/sites/nortetel-cursos.com.br.caddy"'

echo "4) estrutura dividida e o Caddy recusa o arquivo novo: remove o arquivo do Frotas"
mkdir -p "$RAIZ/c4/sites" && printf 'import %s/sites/*.caddy\n' "$RAIZ/c4" >"$RAIZ/c4/Caddyfile"; printf '%s\nINVALIDO\n' "$OUTRO" >"$RAIZ/c4/sites/nortetel-cursos.com.br.caddy"
roda c4
confere "falha e não deixa o arquivo do Frotas" '[[ $RC -ne 0 ]] && [[ ! -e "$D/sites/frotas.209.50.240.59.sslip.io.caddy" ]] && grep -q "FALHA" "$D/saida.txt"'

echo "5) arquivo único TRAVADO sem o Frotas: avisa e não altera"
mkdir -p "$RAIZ/c5" && printf '%s\n' "$OUTRO" >"$RAIZ/c5/Caddyfile"; cp "$RAIZ/c5/Caddyfile" "$RAIZ/c5/orig"; touch "$RAIZ/c5/Caddyfile.imutavel"
roda c5
confere "avisa como recolocar e deixa o reload de lado" '[[ $RC -eq 0 ]] && grep -q "TRAVADO" "$D/saida.txt" && grep -q "CONFIG_WEB=\[\]" "$D/saida.txt" && cmp -s "$D/Caddyfile" "$D/orig"'

echo "6) arquivo único comum sem o Frotas: acrescenta o bloco (comportamento de sempre)"
mkdir -p "$RAIZ/c6" && printf '%s\n' "$OUTRO" >"$RAIZ/c6/Caddyfile"
roda c6
confere "acrescentou o bloco e fez backup" '[[ $RC -eq 0 ]] && grep -q "^frotas.209.50.240.59.sslip.io {" "$D/Caddyfile" && grep -q "127.0.0.1:3000" "$D/Caddyfile" && ls "$D"/Caddyfile.antes-frotas.* >/dev/null 2>&1'

echo
if ((FALHAS == 0)); then echo "TUDO CERTO"; else echo "$FALHAS FALHA(S)"; exit 1; fi
