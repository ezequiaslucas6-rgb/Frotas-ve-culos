#!/usr/bin/env bash
# Atualiza o app na VPS: puxa o código, reconstrói a imagem e reinicia sem derrubar o Nginx.
#   cd /opt/frotas && ./deploy/atualizar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Frotas atualizado: $(git log -1 --format='%h %s')"
