"""
Recalcula os alertas de revisão (por KM e por período) de TODA a frota e persiste manutencoes.status_alerta.

Como o prazo vence com o passar do tempo (sem nenhuma escrita), o painel calcula os alertas ao ler; este job diário
apenas mantém o status persistido em dia (útil para relatórios/consultas SQL). Roda no GitHub Actions
(.github/workflows/alertas.yml) ou manualmente:

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/sincronizar_alertas.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from frotas.infra.cliente import cliente_admin
from frotas.infra.config import ConfigAusente
from frotas.infra.erros import ErroNegocio
from frotas.services.alertas import sincronizar_alertas


def main() -> int:
    try:
        resumo = sincronizar_alertas(cliente_admin())
    except (ConfigAusente, RuntimeError) as exc:
        print(f"Configuração inválida: {exc}", file=sys.stderr)
        return 2
    except ErroNegocio as exc:
        print(f"Falha ao sincronizar: {exc.mensagem}", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **resumo.__dict__}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
