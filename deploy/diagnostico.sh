#!/usr/bin/env bash
# =============================================================================
# Gestão de Frotas — diagnóstico da instalação na VPS (não altera nada).
#   curl -fsSL https://raw.githubusercontent.com/ezequiaslucas6-rgb/Frotas-ve-culos/claude/amazing-ptolemy-j5zi8z/deploy/diagnostico.sh -o diagnostico.sh
#   bash diagnostico.sh
# Gera /tmp/frotas-diagnostico.txt. As chaves do .env NÃO são exibidas (só se estão preenchidas).
# =============================================================================
DOMINIO="${DOMINIO:-frotas.209.50.240.59.sslip.io}"
DIR="${DIR:-/opt/frotas}"
SAIDA=/tmp/frotas-diagnostico.txt
SUDO=""
[[ $EUID -ne 0 ]] && SUDO="sudo"

secao() { printf '\n===== %s =====\n' "$*"; }
rodar() {
  printf '$ %s\n' "$*"
  eval "$*" 2>&1 | tail -n "${LINHAS:-40}"
  true
}

{
  secao "Sistema"
  rodar ". /etc/os-release; echo \$PRETTY_NAME; uname -r"
  rodar "free -m"
  rodar "df -h / | tail -1"

  secao "Código"
  rodar "git -C $DIR log -1 --format='%h %s (%cr)'"
  rodar "git -C $DIR status --short | head"

  secao ".env (somente se cada chave está preenchida)"
  if [[ -f $DIR/.env ]]; then
    for chave in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY CRON_SECRET FROTAS_PORTA; do
      valor=$($SUDO grep -E "^$chave=" "$DIR/.env" | cut -d= -f2-)
      if [[ -z $valor ]]; then estado="VAZIA"; elif [[ $valor == *"<"* ]]; then estado="NÃO PREENCHIDA (modelo)"; else estado="ok (${#valor} caracteres)"; fi
      [[ $chave == NEXT_PUBLIC_SUPABASE_URL && $valor == https://*.supabase.co ]] && estado="ok (${valor%%.supabase.co*}.supabase.co)"
      [[ $chave == FROTAS_PORTA ]] && estado="$valor"
      printf '  %-32s %s\n' "$chave" "$estado"
    done
  else
    echo "  $DIR/.env NÃO existe"
  fi
  PORTA=$($SUDO grep -E '^FROTAS_PORTA=' "$DIR/.env" 2>/dev/null | cut -d= -f2)
  PORTA=${PORTA:-3010}

  secao "Docker / app"
  rodar "$SUDO systemctl is-active docker"
  rodar "$SUDO docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
  rodar "curl -sS -o /dev/null -w 'app local (127.0.0.1:$PORTA/login): HTTP %{http_code}\n' -m 10 http://127.0.0.1:$PORTA/login"
  LINHAS=60 rodar "$SUDO docker logs --tail 60 frotas"

  secao "Quem escuta nas portas 80, 443 e $PORTA"
  rodar "$SUDO ss -ltnp | grep -E ':(80|443|$PORTA)\\b'"

  secao "Painéis / proxies conhecidos"
  for c in /www/server/panel /usr/local/cpanel /usr/local/CyberCP /usr/local/hestia /usr/local/vesta /etc/caddy /opt/traefik; do
    [[ -e $c ]] && echo "  encontrado: $c"
  done
  rodar "$SUDO docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' | grep -E '0.0.0.0:(80|443)->' || echo '  nenhum container publicando 80/443'"

  secao "Nginx"
  if command -v nginx >/dev/null; then
    rodar "nginx -v"
    rodar "$SUDO nginx -t"
    LINHAS=60 rodar "$SUDO nginx -T 2>/dev/null | grep -nE '^\\s*(server_name|listen)\\b'"
    rodar "ls -l /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null"
  else
    echo "  nginx não instalado"
  fi

  secao "Apache"
  if command -v apache2ctl >/dev/null || command -v apachectl >/dev/null; then
    rodar "$SUDO apache2ctl -S 2>&1 || $SUDO apachectl -S"
  else
    echo "  apache não instalado"
  fi

  secao "HTTPS / certificados"
  rodar "$SUDO certbot certificates 2>&1 | grep -E 'Certificate Name|Domains|Expiry'"
  LINHAS=30 rodar "tail -n 30 /tmp/frotas-certbot.log"

  secao "Testes de acesso (feitos pela própria VPS)"
  IP=$(curl -fsS -m 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  echo "  IP público: $IP"
  rodar "getent hosts $DOMINIO"
  rodar "curl -sS -o /dev/null -w 'http  via localhost  -> HTTP %{http_code} %{redirect_url}\n' -m 10 -H 'Host: $DOMINIO' http://127.0.0.1/login"
  rodar "curl -sS -o /dev/null -w 'http  via IP público -> HTTP %{http_code} %{redirect_url}\n' -m 10 --resolve $DOMINIO:80:$IP http://$DOMINIO/login"
  rodar "curl -sS -o /dev/null -w 'https via IP público -> HTTP %{http_code}\n' -m 10 --resolve $DOMINIO:443:$IP https://$DOMINIO/login"
  rodar "curl -sSv -o /dev/null -m 10 --resolve $DOMINIO:443:$IP https://$DOMINIO/login 2>&1 | grep -E 'subject:|issuer:|SSL certificate|expire date' | head -5"

  secao "Firewall"
  rodar "$SUDO ufw status 2>/dev/null || echo 'ufw ausente'"
  rodar "$SUDO iptables -S INPUT 2>/dev/null | head -15"

  secao "Cron de alertas"
  rodar "crontab -l 2>/dev/null | grep frotas-alertas | sed -E 's/Bearer [^ ]+/Bearer ***/'"
} | tee "$SAIDA"

printf '\nRelatório salvo em %s — copie TODO o texto acima e cole na conversa.\n' "$SAIDA"
