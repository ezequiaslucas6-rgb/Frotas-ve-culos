#!/usr/bin/env bash
# =============================================================================
# Rodar — chave FIXA de assinatura do APK (rodar UMA vez)
#
# Com a mesma chave em todas as versões, o celular instala o APK novo POR CIMA do
# anterior (sem desinstalar e sem perder o login). Na VPS:
#   bash /opt/frotas/deploy/gerar-chave-apk.sh
#
# O script cria a chave em ~/rodar-chave-apk (só o seu usuário lê) e mostra os 4
# valores para cadastrar no GitHub: Settings -> Secrets and variables -> Actions.
#   bash gerar-chave-apk.sh --mostrar   # mostra os valores de novo
#
# GUARDE uma cópia da pasta ~/rodar-chave-apk fora da VPS: sem ela, uma chave nova
# obriga todos a desinstalar o app uma vez. Nunca coloque a chave no repositório.
#
# --ci: uso interno do GitHub Actions (chave descartável quando os secrets não existem).
# =============================================================================
set -Eeuo pipefail

PASTA="${PASTA:-$HOME/rodar-chave-apk}"
ALIAS="rodar"
ARQ="$PASTA/rodar.p12"
SENHAS="$PASTA/senha.txt"

msg() { printf '\n\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
falha() {
  printf '\n  \033[1;31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

# PKCS12 com algoritmos que o Java/Android leem em qualquer versão (a chave e o arquivo
# usam a mesma senha, como exige o PKCS12). Validade: 30 anos.
gerar() {
  command -v openssl >/dev/null || falha 'openssl não encontrado (sudo apt install openssl).'
  umask 077
  mkdir -p "$PASTA"
  local senha tmp
  senha="$(openssl rand -hex 24)"
  tmp="$(mktemp -d)"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 10950 -nodes \
    -keyout "$tmp/chave.pem" -out "$tmp/cert.pem" \
    -subj "/CN=Rodar/O=Rodar Gestao de Frotas/C=BR" 2>/dev/null
  openssl pkcs12 -export -inkey "$tmp/chave.pem" -in "$tmp/cert.pem" -name "$ALIAS" \
    -out "$ARQ" -passout "pass:$senha" \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
  rm -rf "$tmp"
  printf '%s\n' "$senha" >"$SENHAS"
  chmod 600 "$ARQ" "$SENHAS"
}

impressao_digital() {
  openssl pkcs12 -in "$ARQ" -passin "pass:$(cat "$SENHAS")" -nokeys -clcerts 2>/dev/null |
    openssl x509 -noout -fingerprint -sha256 | sed 's/^.*=//'
}

if [ "${1:-}" = '--ci' ]; then
  # GitHub Actions sem os secrets: chave descartável só para este build (mesmo caminho de assinatura)
  [ -n "${GITHUB_ENV:-}" ] || falha '--ci só no GitHub Actions.'
  gerar
  senha="$(cat "$SENHAS")"
  echo "::add-mask::$senha"
  {
    echo "ANDROID_KEYSTORE_PATH=$ARQ"
    echo "ANDROID_KEYSTORE_PASSWORD=$senha"
    echo "ANDROID_KEY_ALIAS=$ALIAS"
    echo "ANDROID_KEY_PASSWORD=$senha"
  } >>"$GITHUB_ENV"
  exit 0
fi

if [ -f "$ARQ" ]; then
  [ "${1:-}" = '--mostrar' ] || msg "A chave já existe em $ARQ (não foi trocada). Valores atuais:"
else
  [ "${1:-}" = '--mostrar' ] && falha "Nenhuma chave em $PASTA. Rode sem --mostrar para criar."
  msg 'Criando a chave fixa do APK'
  gerar
  ok "Chave criada em $ARQ"
fi

senha="$(cat "$SENHAS")"
cat <<EOF

No GitHub: repositório -> Settings -> Secrets and variables -> Actions -> New repository secret.
Crie os 4 secrets abaixo (nome exatamente igual; o valor é tudo depois de "=", sem espaços):

  ANDROID_KEY_ALIAS=$ALIAS
  ANDROID_KEYSTORE_PASSWORD=$senha
  ANDROID_KEY_PASSWORD=$senha
  ANDROID_KEYSTORE_BASE64=$(base64 -w0 "$ARQ")

Impressão digital da chave (SHA-256), para conferir no log do GitHub Actions:
  $(impressao_digital)

Depois:
  1. GitHub -> Actions -> "App Android (APK)" -> Run workflow (ou qualquer mudança em android/).
  2. Nos celulares, desinstale o app antigo UMA última vez e instale o novo frotas.apk.
     Daí em diante, cada versão nova instala por cima.
  3. Guarde uma cópia de $PASTA fora da VPS (ex.: pendrive ou cofre de senhas).
EOF
