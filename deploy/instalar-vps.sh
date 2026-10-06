#!/usr/bin/env bash
# =============================================================================
# Rodar (Gestão de Frotas) — instalação / atualização na VPS (Debian / Ubuntu)
#
# Na VPS, logado com seu usuário (precisa de sudo):
#   curl -fsSL https://raw.githubusercontent.com/ezequiaslucas6-rgb/Frotas-ve-culos/claude/amazing-ptolemy-j5zi8z/deploy/instalar-vps.sh -o instalar-vps.sh
#   bash instalar-vps.sh
#
# 1ª execução: instala o que faltar, baixa o código e cria /opt/frotas/.env para você preencher as chaves.
# 2ª execução (depois de preencher o .env): sobe o app, configura o servidor web, o HTTPS e o cron de alertas.
# Pode rodar quantas vezes quiser: nas próximas, apenas atualiza.
#
# Variáveis opcionais: DOMINIO, BRANCH, DIR, PORTA, EMAIL_CERTBOT  (ex.: PORTA=3011 bash instalar-vps.sh)
# =============================================================================
set -Eeuo pipefail

DOMINIO="${DOMINIO:-frotas.209.50.240.59.sslip.io}"
REPO="${REPO:-https://github.com/ezequiaslucas6-rgb/Frotas-ve-culos.git}"
BRANCH="${BRANCH:-claude/amazing-ptolemy-j5zi8z}"
DIR="${DIR:-/opt/frotas}"
PORTA="${PORTA:-3010}"
EMAIL_CERTBOT="${EMAIL_CERTBOT:-}"

msg() { printf '\n\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
falha() {
  printf '\n  \033[1;31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}
trap 'falha "Erro na linha $LINENO: $BASH_COMMAND"' ERR

# Nunca executa direto de dentro do repositório: o "git pull" abaixo poderia alterar este arquivo
# enquanto o bash ainda o lê. Roda de uma cópia temporária.
if [[ -z ${FROTAS_COPIA:-} && -f $0 && $(realpath "$0") == "$(realpath -m "$DIR")"/* ]]; then
  COPIA=$(mktemp /tmp/frotas-instalar.XXXXXX)
  cp "$0" "$COPIA"
  FROTAS_COPIA=1 exec bash "$COPIA" "$@"
fi

# uma atualização por vez (a automática, deploy/auto-atualizar.sh, usa a mesma trava e avisa com FROTAS_TRAVA)
if [[ -z ${FROTAS_TRAVA:-} ]]; then
  exec 9>/tmp/frotas-atualizacao.lock
  flock -n 9 || falha "Já há uma atualização em andamento (a automática). Aguarde alguns minutos e rode de novo."
fi

# ----------------------------------------------------------------------------- pré-requisitos
msg "Verificando o sistema"
if [[ $EUID -eq 0 ]]; then
  SUDO=""
else
  command -v sudo >/dev/null || falha "sudo não encontrado. Rode como root ou instale o sudo."
  sudo -v || falha "Seu usuário precisa de permissão sudo."
  SUDO="sudo"
fi
USUARIO="$(id -un)"

[[ -r /etc/os-release ]] && . /etc/os-release
command -v apt-get >/dev/null || falha "Este script suporta Debian/Ubuntu (apt). Sistema detectado: ${PRETTY_NAME:-desconhecido}."
ok "${PRETTY_NAME:-Linux com apt}"

export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git curl ca-certificates openssl iproute2 >/dev/null
ok "git, curl e openssl"

# ----------------------------------------------------------------------------- Docker
msg "Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | $SUDO sh >/dev/null
  ok "Docker instalado"
else
  ok "Docker já instalado ($(docker --version | cut -d, -f1))"
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true
if ! $SUDO docker compose version >/dev/null 2>&1; then
  $SUDO apt-get install -y -qq docker-compose-plugin >/dev/null || falha "Não consegui instalar o docker compose."
fi
DOCKER="$SUDO docker"
ok "docker compose $($DOCKER compose version --short)"

# ----------------------------------------------------------------------------- código
msg "Código em $DIR (branch $BRANCH)"
if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" pull -q --ff-only origin "$BRANCH"
  ok "Atualizado: $(git -C "$DIR" log -1 --format='%h %s')"
else
  $SUDO mkdir -p "$DIR"
  $SUDO chown "$USUARIO" "$DIR"
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
  ok "Baixado: $(git -C "$DIR" log -1 --format='%h %s')"
fi
cd "$DIR"

# Se o git pull trouxe uma versão nova deste instalador, reinicia já com ela (uma única vez).
if [[ -z ${FROTAS_ATUALIZADO:-} && -f $0 ]] && ! cmp -s "$0" "$DIR/deploy/instalar-vps.sh"; then
  ok "Instalador atualizado: reiniciando com a versão nova"
  COPIA=$(mktemp /tmp/frotas-instalar.XXXXXX)
  cp "$DIR/deploy/instalar-vps.sh" "$COPIA"
  FROTAS_COPIA=1 FROTAS_ATUALIZADO=1 exec bash "$COPIA" "$@"
fi

# ----------------------------------------------------------------------------- .env
msg "Configuração (.env)"
if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i "s|^CRON_SECRET=.*|CRON_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^FROTAS_PORTA=.*|FROTAS_PORTA=$PORTA|" .env
  chmod 600 .env
  ok "Criado $DIR/.env (CRON_SECRET gerado automaticamente)"
fi
if grep -qE '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=.*<' .env; then
  cat <<EOF

  Falta preencher as chaves do Supabase (Project Settings > API) em:

      nano $DIR/.env

    NEXT_PUBLIC_SUPABASE_URL        = Project URL (https://xxxx.supabase.co)
    NEXT_PUBLIC_SUPABASE_ANON_KEY   = anon / publishable key
    SUPABASE_SERVICE_ROLE_KEY       = service_role key (secreta)

  Salve (Ctrl+O, Enter, Ctrl+X) e rode de novo:

      bash $DIR/deploy/instalar-vps.sh

EOF
  exit 0
fi
grep -qE '^NEXT_PUBLIC_SUPABASE_URL=https://' .env || aviso "NEXT_PUBLIC_SUPABASE_URL deveria começar com https://"
PORTA="$(grep -E '^FROTAS_PORTA=' .env | cut -d= -f2 || true)"
PORTA="${PORTA:-3010}"
CRON_SECRET="$(grep -E '^CRON_SECRET=' .env | cut -d= -f2-)"
[[ ${#CRON_SECRET} -ge 32 ]] || falha "CRON_SECRET no .env precisa ter pelo menos 32 caracteres (gere com: openssl rand -hex 32)."
ok "Chaves preenchidas"

# variáveis novas de versões mais recentes entram no .env de quem já tinha instalado
if ! grep -qE '^GEMINI_API_KEY=' .env; then
  cat >>.env <<'EOF'

# Leitura automática do cupom de abastecimento (opcional). Chave gratuita em
# https://aistudio.google.com/apikey — fica só no servidor. Sem ela, o lançamento é digitado à mão.
GEMINI_API_KEY=
GEMINI_MODELOS=gemini-flash-latest,gemini-flash-lite-latest
EOF
  ok "Acrescentado GEMINI_API_KEY ao .env (leitura automática do cupom)"
fi
# a ordem antiga (Lite primeiro) lia dígitos miúdos errado: passa para o Flash primeiro
if grep -qxF 'GEMINI_MODELOS=gemini-flash-lite-latest,gemini-flash-latest' .env; then
  sed -i 's/^GEMINI_MODELOS=gemini-flash-lite-latest,gemini-flash-latest$/GEMINI_MODELOS=gemini-flash-latest,gemini-flash-lite-latest/' .env
  ok "Leitura do cupom: modelo Flash primeiro (lê melhor os números)"
fi
if grep -qE '^GEMINI_API_KEY=.+' .env; then
  ok "Leitura automática do cupom: ligada"
else
  aviso "Leitura automática do cupom desligada: coloque a chave do Gemini em GEMINI_API_KEY no $DIR/.env e rode de novo"
fi

# ----------------------------------------------------------------------------- memória p/ o build
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if ((MEM_MB + SWAP_MB < 2500)) && [[ ! -f /swapfile ]]; then
  msg "Memória curta para o build (${MEM_MB} MB RAM + ${SWAP_MB} MB swap): criando swap de 2 GB"
  $SUDO fallocate -l 2G /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
  ok "Swap ativo (permanente)"
fi

# ----------------------------------------------------------------------------- app
msg "Subindo o app (127.0.0.1:$PORTA)"
if $SUDO ss -ltnH "sport = :$PORTA" | grep -q . && ! $DOCKER ps --format '{{.Names}}' | grep -qx frotas; then
  falha "A porta $PORTA já está em uso por outro programa. Rode de novo com outra porta, ex.: PORTA=3011 bash $DIR/deploy/instalar-vps.sh (e ajuste FROTAS_PORTA no .env)."
fi
# versão deste build: o app aberto nos celulares percebe a troca e recarrega sozinho
VERSAO_APP="$(git -C "$DIR" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
$DOCKER compose build --build-arg VERSAO_APP="$VERSAO_APP"
$DOCKER compose up -d
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORTA/login" && break
  sleep 2
done
curl -fsS -o /dev/null "http://127.0.0.1:$PORTA/login" || falha "O app não respondeu. Veja os logs: $DOCKER compose -f $DIR/docker-compose.yml logs --tail 80"
$DOCKER image prune -f >/dev/null
ok "App no ar localmente"

# ----------------------------------------------------------------------------- servidor web
msg "Servidor web para $DOMINIO"
QUEM80="$($SUDO ss -ltnpH 'sport = :80' 2>/dev/null || true)"
if grep -q caddy <<<"$QUEM80"; then
  WEB=caddy
elif grep -q nginx <<<"$QUEM80"; then
  WEB=nginx
elif grep -qE 'apache2|httpd' <<<"$QUEM80"; then
  WEB=apache
elif [[ -z "$QUEM80" ]]; then
  WEB=nginx
  $SUDO apt-get install -y -qq nginx >/dev/null
  $SUDO systemctl enable --now nginx >/dev/null
  ok "Nenhum servidor na porta 80: Nginx instalado"
else
  WEB=outro
fi
ok "Servidor detectado: $WEB"

CONFIG_WEB=""
case "$WEB" in
  nginx)
    if [[ -d /www/server/panel/vhost/nginx ]]; then # aaPanel / BT
      CONFIG_WEB=/www/server/panel/vhost/nginx/frotas.conf
    elif [[ -d /etc/nginx/sites-available ]]; then
      CONFIG_WEB=/etc/nginx/sites-available/frotas.conf
    else
      CONFIG_WEB=/etc/nginx/conf.d/frotas.conf
    fi
    if $SUDO grep -qs "server_name $DOMINIO" "$CONFIG_WEB"; then
      ok "Configuração já existe ($CONFIG_WEB)"
    else
      sed -e "s/frotas\.SEUDOMINIO\.com\.br/$DOMINIO/g" -e "s/127\.0\.0\.1:3010/127.0.0.1:$PORTA/g" deploy/nginx/frotas.conf |
        $SUDO tee "$CONFIG_WEB" >/dev/null
      [[ -d /etc/nginx/sites-enabled && $CONFIG_WEB == /etc/nginx/sites-available/* ]] &&
        $SUDO ln -sf "$CONFIG_WEB" /etc/nginx/sites-enabled/frotas.conf
      ok "Configuração criada ($CONFIG_WEB)"
    fi
    $SUDO nginx -t >/dev/null 2>&1 || {
      $SUDO nginx -t || true
      falha "A configuração do Nginx tem erro (veja acima). Nada foi recarregado."
    }
    $SUDO systemctl reload nginx 2>/dev/null || $SUDO nginx -s reload
    ok "Nginx recarregado"
    ;;
  apache)
    CONFIG_WEB=/etc/apache2/sites-available/frotas.conf
    [[ -d /etc/apache2/sites-available ]] || falha "Apache sem /etc/apache2 (instalação não padrão). Configure um proxy de $DOMINIO para http://127.0.0.1:$PORTA."
    if ! $SUDO grep -qs "ServerName $DOMINIO" "$CONFIG_WEB"; then
      $SUDO tee "$CONFIG_WEB" >/dev/null <<EOF
<VirtualHost *:80>
    ServerName $DOMINIO
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
    ProxyPass / http://127.0.0.1:$PORTA/
    ProxyPassReverse / http://127.0.0.1:$PORTA/
    LimitRequestBody 4194304
</VirtualHost>
EOF
      ok "Configuração criada ($CONFIG_WEB)"
    fi
    $SUDO a2enmod -q proxy proxy_http headers >/dev/null
    $SUDO a2ensite -q frotas >/dev/null
    $SUDO apachectl configtest >/dev/null 2>&1 || falha "A configuração do Apache tem erro (rode: sudo apachectl configtest)."
    $SUDO systemctl reload apache2
    ok "Apache recarregado"
    ;;
  caddy)
    # Usa o MESMO arquivo que o Caddy em execução carregou (nunca adivinha), com backup e validação.
    CADDY_PID=$(pgrep -xo caddy || true)
    CADDY_ARGS=$(ps -o args= -p "$CADDY_PID" 2>/dev/null || true)
    CONFIG_WEB=$(sed -nE 's/.*--config[ =]([^ ]+).*/\1/p' <<<"$CADDY_ARGS")
    if [[ -z $CONFIG_WEB ]] && systemctl is-active -q caddy 2>/dev/null; then
      CONFIG_WEB=/etc/caddy/Caddyfile # padrão do serviço systemd do pacote
    fi
    if [[ -z $CONFIG_WEB || ! -f $CONFIG_WEB || $CONFIG_WEB == *.json ]]; then
      aviso "Não identifiquei o Caddyfile em uso (processo: ${CADDY_ARGS:-?})."
      aviso "Adicione manualmente ao Caddyfile e recarregue o Caddy:"
      printf '\n      %s {\n          reverse_proxy 127.0.0.1:%s\n      }\n\n' "$DOMINIO" "$PORTA"
      CONFIG_WEB=""
    elif $SUDO grep -qs "^$DOMINIO {" "$CONFIG_WEB"; then
      ok "Site já configurado no Caddy ($CONFIG_WEB)"
    else
      BACKUP="$CONFIG_WEB.antes-frotas.$(date +%Y%m%d%H%M%S)"
      $SUDO cp -a "$CONFIG_WEB" "$BACKUP"
      printf '\n# >>> frotas (adicionado por deploy/instalar-vps.sh)\n%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n\theader {\n\t\tX-Content-Type-Options nosniff\n\t\tReferrer-Policy strict-origin-when-cross-origin\n\t}\n}\n# <<< frotas\n' \
        "$DOMINIO" "$PORTA" | $SUDO tee -a "$CONFIG_WEB" >/dev/null
      if ! $SUDO caddy validate --config "$CONFIG_WEB" --adapter caddyfile >/tmp/frotas-caddy.log 2>&1; then
        $SUDO cp -a "$BACKUP" "$CONFIG_WEB"
        falha "O Caddyfile ficou inválido e foi restaurado (backup: $BACKUP). Detalhes: /tmp/frotas-caddy.log"
      fi
      ok "Site adicionado ao Caddy ($CONFIG_WEB; backup em $BACKUP)"
    fi
    if [[ -n $CONFIG_WEB ]]; then
      if systemctl is-active -q caddy 2>/dev/null; then
        $SUDO systemctl reload caddy
      else
        $SUDO caddy reload --config "$CONFIG_WEB" --adapter caddyfile
      fi
      ok "Caddy recarregado (o seu outro site não foi alterado)"
    fi
    ;;
  outro)
    aviso "A porta 80 está com: $(awk '{print $NF}' <<<"$QUEM80" | head -1)"
    aviso "Configure nele um proxy de $DOMINIO para http://127.0.0.1:$PORTA e rode este script de novo."
    ;;
esac

if command -v ufw >/dev/null && $SUDO ufw status | grep -q "Status: active"; then
  $SUDO ufw allow 80/tcp >/dev/null && $SUDO ufw allow 443/tcp >/dev/null
  ok "Firewall (ufw): portas 80 e 443 liberadas"
fi

# ----------------------------------------------------------------------------- HTTPS
URL="http://$DOMINIO"
if [[ $WEB == caddy && -n $CONFIG_WEB ]]; then
  msg "HTTPS (emitido automaticamente pelo Caddy)"
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null -m 10 "https://$DOMINIO/login" && break
    sleep 3
  done
  if curl -fsS -o /dev/null -m 10 "https://$DOMINIO/login"; then
    URL="https://$DOMINIO"
    ok "Certificado ativo (renovação automática pelo Caddy)"
  else
    aviso "O certificado ainda não ficou pronto. Veja: sudo journalctl -u caddy --since '10 min ago' | grep -i $DOMINIO"
  fi
fi
if [[ $WEB == nginx || $WEB == apache ]] && [[ $CONFIG_WEB != /www/server/* ]]; then
  msg "HTTPS (Let's Encrypt)"
  PLUGIN=$([[ $WEB == nginx ]] && echo python3-certbot-nginx || echo python3-certbot-apache)
  $SUDO apt-get install -y -qq certbot "$PLUGIN" >/dev/null
  if [[ -n $EMAIL_CERTBOT ]]; then CONTATO=(-m "$EMAIL_CERTBOT"); else CONTATO=(--register-unsafely-without-email); fi
  if $SUDO certbot "--$WEB" -d "$DOMINIO" --non-interactive --agree-tos --redirect --keep-until-expiring "${CONTATO[@]}" >/tmp/frotas-certbot.log 2>&1; then
    URL="https://$DOMINIO"
    ok "Certificado ativo (renovação automática pelo certbot)"
  else
    aviso "Não foi possível emitir o certificado agora (detalhes: /tmp/frotas-certbot.log). O app segue em http."
    aviso "Rode este script de novo mais tarde para tentar outra vez."
  fi
elif [[ $CONFIG_WEB == /www/server/* ]]; then
  aviso "Painel (aaPanel) detectado: emita o SSL de $DOMINIO pelo próprio painel."
fi

# ----------------------------------------------------------------------------- cron de alertas
msg "Alertas diários de revisão"
# 09:00 de Brasília (UTC-3) no fuso do servidor
DESLOCAMENTO=$(date +%z)
HORAS=$((10#${DESLOCAMENTO:1:2}))
[[ ${DESLOCAMENTO:0:1} == "-" ]] && HORAS=$((-HORAS))
HORA=$(((12 + HORAS + 24) % 24))
LINHA="0 $HORA * * * curl -fsS -m 60 -H 'Authorization: Bearer $CRON_SECRET' http://127.0.0.1:$PORTA/api/cron/alertas >/dev/null 2>&1 # frotas-alertas"
(crontab -l 2>/dev/null | grep -v 'frotas-alertas' || true; echo "$LINHA") | crontab -
ok "Agendado todo dia às $(printf '%02d' "$HORA"):00 (horário do servidor = 09:00 de Brasília)"
if curl -fsS -m 60 -H "Authorization: Bearer $CRON_SECRET" "http://127.0.0.1:$PORTA/api/cron/alertas" >/dev/null; then
  ok "Teste do cron: ok (conexão com o Supabase funcionando)"
else
  aviso "Teste do cron falhou: confira SUPABASE_SERVICE_ROLE_KEY e a URL no .env (depois: docker compose up -d --build)."
fi

# ----------------------------------------------------------------------------- atualização automática
msg "Atualização automática"
if [[ ${AUTO_ATUALIZAR:-1} == 1 ]]; then
  # no cron do root: atualizar envolve docker e o servidor web
  LINHA_AUTO="*/10 * * * * bash $DIR/deploy/auto-atualizar.sh >/dev/null 2>&1 # frotas-auto-atualizar"
  ($SUDO crontab -l 2>/dev/null | grep -v 'frotas-auto-atualizar' || true; echo "$LINHA_AUTO") | $SUDO crontab -
  ok "A VPS confere o GitHub a cada 10 min e se atualiza sozinha (histórico: $DIR/atualizacao.log)"
  ok "Versão nova com migration de banco espera você rodar o SQL (aviso em $DIR/ATUALIZACAO_PENDENTE.txt)"
else
  ($SUDO crontab -l 2>/dev/null | grep -v 'frotas-auto-atualizar' || true) | $SUDO crontab -
  aviso "Atualização automática desligada (AUTO_ATUALIZAR=0). Para religar, rode o instalador sem essa variável."
fi

# ----------------------------------------------------------------------------- fim
msg "Pronto"
CODIGO=$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "$URL/login" || echo "---")
if [[ $CODIGO == 200 ]]; then ok "$URL respondeu 200"; else aviso "$URL respondeu $CODIGO (o DNS/SSL pode levar alguns minutos)"; fi
cat <<EOF

  Acesse:     $URL
  Atualizar:  bash $DIR/deploy/instalar-vps.sh
  Logs:       $DOCKER compose -f $DIR/docker-compose.yml logs -f

  Lembretes:
   - O 1º acesso precisa do perfil de administrador no Supabase (veja o README, passo "Primeiro Administrador").
   - Troque a senha SSH se ela foi compartilhada:  passwd

EOF
