#!/usr/bin/env bash
# Atualiza o app na VPS (puxa o código, reconstrói e reinicia). Atalho para o instalador, que é idempotente.
#   bash /opt/frotas/deploy/atualizar.sh
exec bash "$(dirname "$0")/instalar-vps.sh" "$@"
