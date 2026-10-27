#!/usr/bin/env bash
# Teste do deploy/dividir-caddy.sh com um "caddy" de mentirinha (valida chaves, import e endereços repetidos).
# O Caddy de verdade não roda aqui: o script em produção usa o `caddy validate` real, e volta atrás se falhar.
#   bash deploy/testes/dividir-caddy.test.sh
set -Eeuo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$AQUI/../dividir-caddy.sh"
RAIZ="$(mktemp -d /tmp/teste-dividir-caddy.XXXXXX)"
trap 'rm -rf "$RAIZ"' EXIT
FALHAS=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
ruim() { printf '  \033[31m✗ %s\033[0m\n' "$*"; FALHAS=$((FALHAS + 1)); }
confere() { if eval "$2"; then ok "$1"; else ruim "$1   [$2]"; fi; }

# ---- caddy de mentirinha -------------------------------------------------------------------
mkdir -p "$RAIZ/bin"
cat >"$RAIZ/bin/caddy" <<'STUB'
#!/usr/bin/env bash
cmd=$1; shift; cfg=""
while [[ $# -gt 0 ]]; do case $1 in --config) cfg=$2; shift 2 ;; *) shift ;; esac; done
[[ -f $cfg ]] || { echo "arquivo não existe: $cfg" >&2; exit 1; }
# junta o arquivo com os imports (glob absoluto)
junta() { while IFS= read -r l; do if [[ $l =~ ^import[[:space:]]+(.+)$ ]]; then for f in ${BASH_REMATCH[1]}; do [[ -f $f ]] && cat "$f"; done; else printf '%s\n' "$l"; fi; done <"$cfg"; }
tudo="$(junta)"
case $cmd in
  validate)
    grep -q INVALIDO <<<"$tudo" && { echo "Error: adapting config: INVALIDO" >&2; exit 1; }
    awk '{ t=$0; sub(/(^|[ \t])#.*/,"",t); gsub(/\{[^{}]*\}/,"",t); a=gsub(/\{/,"{",t); b=gsub(/\}/,"}",t); p+=a-b; if (p<0) { print "chave a mais" > "/dev/stderr"; exit 1 } }
         END { if (p!=0) { print "chaves desbalanceadas" > "/dev/stderr"; exit 1 } }' <<<"$tudo" || exit 1
    dup=$(awk 'p==0 && /^[^ \t#}][^#]*\{[ \t]*$/ && !/^\(/ { h=$0; sub(/[ \t]*\{.*/,"",h); print h }
               { t=$0; sub(/(^|[ \t])#.*/,"",t); gsub(/\{[^{}]*\}/,"",t); a=gsub(/\{/,"{",t); b=gsub(/\}/,"}",t); p+=a-b }' <<<"$tudo" | sort | uniq -d)
    [[ -z $dup ]] || { echo "ambiguous site definition: $dup" >&2; exit 1; }
    echo "Valid configuration" ;;
  adapt)
    awk 'p==0 && /^[^ \t#}][^#]*\{/ && !/^\(/ { h=$0; sub(/[ \t]*\{.*/,"",h); n=split(h,x,/[ ,]+/); printf "{\"host\":[\"%s\"]}\n", x[1] }
         /reverse_proxy/ { printf "{\"dial\":\"%s\"}\n", $2 }
         { t=$0; sub(/(^|[ \t])#.*/,"",t); gsub(/\{[^{}]*\}/,"",t); a=gsub(/\{/,"{",t); b=gsub(/\}/,"}",t); p+=a-b }' <<<"$tudo" ;;
  reload) echo reload ;;
esac
STUB
chmod +x "$RAIZ/bin/caddy"
# lsattr/chattr de mentirinha (o arquivo-marca diz se está "travado")
cat >"$RAIZ/bin/lsattr" <<'STUB'
#!/usr/bin/env bash
f=${@: -1}; if [[ -e "$f.imutavel" ]]; then echo "----i---------e------- $f"; else echo "--------------e------- $f"; fi
STUB
cat >"$RAIZ/bin/chattr" <<'STUB'
#!/usr/bin/env bash
f=${@: -1}; case $1 in +i) touch "$f.imutavel" ;; -i) rm -f "$f.imutavel" ;; esac; echo "chattr $*" >>"${CHATTR_LOG:-/dev/null}"
STUB
chmod +x "$RAIZ/bin/lsattr" "$RAIZ/bin/chattr"
export PATH="$RAIZ/bin:$PATH"

novo_cenario() { # $1 = nome; escreve $D/Caddyfile a partir do stdin
  D="$RAIZ/$1"; mkdir -p "$D"; cat >"$D/Caddyfile"
  export CADDY_DIR="$D" ARQUIVO="$D/Caddyfile" SITES="$D/sites" CADDY_BIN="$RAIZ/bin/caddy" SERVICO_RELOAD="echo reload >>$D/reload.log" CHATTR_LOG="$D/chattr.log"
  rm -rf "$D/sites" "$D/reload.log" "$D/chattr.log"
}
roda() { set +e; bash "$SCRIPT" "$@" >"$D/saida.txt" 2>&1; RC=$?; set -e; }

CINCO='nortetel-cursos.com.br {
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-For {remote_host}
	}
}

# >>> frotas (adicionado por deploy/instalar-vps.sh)
frotas.209.50.240.59.sslip.io {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3010
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}
}
# <<< frotas

remap.209.50.240.59.sslip.io {
	reverse_proxy 127.0.0.1:3020
}
espetodahora.209.50.240.59.sslip.io {
	reverse_proxy 127.0.0.1:3030
}
workpop.209.50.240.59.sslip.io {
	handle /api/* {
		reverse_proxy 127.0.0.1:3040
	}
	handle {
		reverse_proxy 127.0.0.1:3041
	}
}'

echo "1) cinco sites, com comentários e blocos aninhados"
novo_cenario c1 <<<"$CINCO"
cp "$D/Caddyfile" "$D/original"
roda --simular
confere "simular não altera nada" 'cmp -s "$D/Caddyfile" "$D/original" && [[ ! -d "$D/sites" ]]'
roda
confere "divide e termina com sucesso" '[[ $RC -eq 0 ]] && grep -q "Pronto" "$D/saida.txt"'
confere "um arquivo por site (5)" '[[ $(ls "$D/sites" | wc -l) -eq 5 ]]'
confere "frotas tem o próprio arquivo, com o bloco inteiro" 'grep -q "reverse_proxy 127.0.0.1:3010" "$D/sites/frotas.209.50.240.59.sslip.io.caddy" && grep -q "Referrer-Policy" "$D/sites/frotas.209.50.240.59.sslip.io.caddy"'
confere "o comentário do bloco acompanha o frotas" 'grep -q ">>> frotas" "$D/sites/frotas.209.50.240.59.sslip.io.caddy"'
confere "workpop manteve os blocos aninhados" '[[ $(grep -c "reverse_proxy" "$D/sites/workpop.209.50.240.59.sslip.io.caddy") -eq 2 ]]'
confere "o principal só tem comentário + import" '! grep -qE "^[^#]*\{" "$D/Caddyfile" && grep -q "^import $D/sites/\*.caddy" "$D/Caddyfile"'
confere "o Caddy foi recarregado e o principal travado" '[[ -f "$D/reload.log" ]] && [[ -e "$D/Caddyfile.imutavel" ]]'
confere "o backup do original existe e é idêntico" 'cmp -s "$D"/Caddyfile.antes-dividir.* "$D/original"'
roda
confere "rodar de novo é recusado (já dividido) sem mexer em nada" '[[ $RC -ne 0 ]] && grep -q "já existe" "$D/saida.txt"'

echo "2) opções globais, snippet, import, {\$VAR}, bloco de uma linha e comentário na linha do endereço"
novo_cenario c2 <<'C2'
{
	email admin@exemplo.com
}

(seguranca) {
	header X-Frame-Options DENY
}

import /etc/caddy/outros/*.conf

{$DOMINIO} {
	import seguranca
	reverse_proxy 127.0.0.1:4000
}
um.exemplo.com { respond "ok" }
dois.exemplo.com, www.dois.exemplo.com { # com comentário
	reverse_proxy 127.0.0.1:4100
}
http://tres.exemplo.com:8080 {
	reverse_proxy 127.0.0.1:4200
}
C2
mkdir -p /etc/caddy/outros 2>/dev/null || true
roda
confere "divide com sucesso" '[[ $RC -eq 0 ]]'
confere "global, snippet e import ficaram no principal" 'grep -q "email admin@exemplo.com" "$D/Caddyfile" && grep -q "^(seguranca)" "$D/Caddyfile" && grep -q "^import /etc/caddy/outros" "$D/Caddyfile"'
confere "4 sites em 4 arquivos (nomes limpos)" '[[ $(ls "$D/sites" | wc -l) -eq 4 ]] && [[ -f "$D/sites/um.exemplo.com.caddy" && -f "$D/sites/dois.exemplo.com.caddy" && -f "$D/sites/tres.exemplo.com_8080.caddy" ]]'
confere "o site com {\$VAR} foi separado (var-DOMINIO.caddy)" '[[ -f "$D/sites/var-DOMINIO.caddy" ]] && grep -q "reverse_proxy 127.0.0.1:4000" "$D/sites/var-DOMINIO.caddy"'

echo "3) formato que o script não entende: aborta sem alterar"
novo_cenario c3 <<'C3'
exemplo.com
reverse_proxy 127.0.0.1:5000
C3
cp "$D/Caddyfile" "$D/original"
roda
confere "recusa" '[[ $RC -ne 0 ]] && grep -q "não reconhecido\|Não consegui separar" "$D/saida.txt"'
confere "nada foi alterado" 'cmp -s "$D/Caddyfile" "$D/original" && [[ ! -d "$D/sites" ]]'

echo "4) Caddyfile já inválido: não mexe"
novo_cenario c4 <<<"$CINCO
INVALIDO"
cp "$D/Caddyfile" "$D/original"
roda
confere "recusa e não altera" '[[ $RC -ne 0 ]] && cmp -s "$D/Caddyfile" "$D/original" && [[ ! -d "$D/sites" ]]'

echo "5) o Caddy não recarrega: volta ao original"
novo_cenario c5 <<<"$CINCO"
cp "$D/Caddyfile" "$D/original"
export SERVICO_RELOAD="exit 1"
roda
confere "falha e avisa" '[[ $RC -ne 0 ]] && grep -q "voltei ao original\|Voltando" "$D/saida.txt"'
confere "o Caddyfile voltou idêntico e a pasta sites foi removida" 'cmp -s "$D/Caddyfile" "$D/original" && [[ ! -d "$D/sites" ]] && [[ ! -e "$D/Caddyfile.novo" ]]'

echo "6) Caddyfile estava travado: destrava, divide e trava de novo"
novo_cenario c6 <<<"$CINCO"
touch "$D/Caddyfile.imutavel"
roda --sem-travar
confere "dividiu" '[[ $RC -eq 0 ]] && [[ $(ls "$D/sites" | wc -l) -eq 5 ]]'
confere "voltou a travar (estava travado antes)" '[[ -e "$D/Caddyfile.imutavel" ]] && grep -q "chattr -i" "$D/chattr.log" && grep -q "chattr +i" "$D/chattr.log"'

echo "7) com o Caddyfile travado e falha no meio: restaura e mantém travado"
novo_cenario c7 <<<"$CINCO"
cp "$D/Caddyfile" "$D/original"; touch "$D/Caddyfile.imutavel"
export SERVICO_RELOAD="exit 1"
roda
confere "restaurou e continua travado" '[[ $RC -ne 0 ]] && cmp -s "$D/Caddyfile" "$D/original" && [[ -e "$D/Caddyfile.imutavel" ]]'

echo
if ((FALHAS == 0)); then echo "TUDO CERTO"; else echo "$FALHAS FALHA(S)"; exit 1; fi
