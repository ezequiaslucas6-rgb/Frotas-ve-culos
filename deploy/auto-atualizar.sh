#!/usr/bin/env bash
# Atualização automática da VPS. O instalador agenda no cron a cada 10 minutos
# (para desligar: AUTO_ATUALIZAR=0 bash /opt/frotas/deploy/instalar-vps.sh).
#
# Busca o branch no GitHub. Se há versão nova:
#   - sem migration nova (supabase/migrations): atualiza sozinho (o mesmo que o atualizar.sh:
#     baixa, constrói e troca o container). Os celulares recarregam o app sozinhos em seguida.
#   - com migration nova: NÃO atualiza (o código novo precisa do banco atualizado) e deixa o aviso
#     em /opt/frotas/ATUALIZACAO_PENDENTE.txt. Rode a migration no SQL Editor do Supabase e depois:
#       bash /opt/frotas/deploy/atualizar.sh
# Histórico: /opt/frotas/atualizacao.log
set -uo pipefail

DIR="${DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$DIR/atualizacao.log"
# roda como root (cron) num repositório que pode ser de outro usuário: o git precisa confiar na pasta
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$DIR"
PENDENTE="$DIR/ATUALIZACAO_PENDENTE.txt"
registrar() { printf '%s  %s\n' "$(date '+%d/%m/%Y %H:%M')" "$*" >>"$LOG"; }

# uma atualização por vez (inclusive com o instalador rodando à mão)
exec 9>/tmp/frotas-atualizacao.lock
flock -n 9 || exit 0

# histórico pequeno
if [[ -f $LOG && $(stat -c %s "$LOG") -gt 1048576 ]]; then tail -n 400 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD)"
git -C "$DIR" fetch -q origin "$BRANCH" 2>/dev/null || exit 0 # sem internet: tenta na próxima
LOCAL="$(git -C "$DIR" rev-parse HEAD)"
REMOTO="$(git -C "$DIR" rev-parse "origin/$BRANCH")"
if [[ $LOCAL == "$REMOTO" ]]; then
  rm -f "$PENDENTE"
  exit 0
fi
# só avança (nunca volta nem mistura com alterações locais)
git -C "$DIR" merge-base --is-ancestor "$LOCAL" "$REMOTO" || {
  registrar "Versão do GitHub não continua a instalada ($LOCAL x $REMOTO): atualize à mão com deploy/atualizar.sh"
  exit 0
}

MIGRATIONS="$(git -C "$DIR" diff --name-only --diff-filter=A "$LOCAL" "$REMOTO" -- supabase/migrations/ | sed 's|.*/||')"
if [[ -n $MIGRATIONS ]]; then
  if ! grep -q "$REMOTO" "$PENDENTE" 2>/dev/null; then
    {
      echo "Atualização aguardando o banco (versão ${REMOTO:0:7}, $(date '+%d/%m/%Y %H:%M'))."
      echo
      echo "Rode no SQL Editor do Supabase, nesta ordem (uma por vez):"
      while read -r m; do echo "  - supabase/migrations/$m"; done <<<"$MIGRATIONS"
      echo
      echo "Depois: bash $DIR/deploy/atualizar.sh"
      echo "(commit $REMOTO)"
    } >"$PENDENTE"
    registrar "Nova versão ${REMOTO:0:7} precisa de migration ($(echo "$MIGRATIONS" | tr '\n' ' ')): aguardando. Veja $PENDENTE"
  fi
  exit 0
fi

rm -f "$PENDENTE"
registrar "Atualizando ${LOCAL:0:7} -> ${REMOTO:0:7}"
if FROTAS_TRAVA=1 bash "$DIR/deploy/instalar-vps.sh" >>"$LOG" 2>&1; then
  registrar "Atualizado para ${REMOTO:0:7}"
else
  registrar "A atualização falhou (o app anterior continua no ar). Detalhes acima; para tentar à mão: bash $DIR/deploy/atualizar.sh"
fi
