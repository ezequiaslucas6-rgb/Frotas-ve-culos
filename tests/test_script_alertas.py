"""O job diário de alertas (GitHub Actions) roda de ponta a ponta contra o Supabase falso."""

from __future__ import annotations

import json
import runpy
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def _executar(monkeypatch=None) -> int:
    ns = runpy.run_path(str(RAIZ / "scripts" / "sincronizar_alertas.py"))
    return ns["main"]()


def test_sincroniza_toda_a_frota(fake, capsys):
    assert _executar() == 0
    saida = json.loads(capsys.readouterr().out)
    assert saida["ok"] is True and saida["veiculos"] == 4
    assert saida["vencidos"] == 1 and saida["proximos"] == 1  # XYZ9K88 vencida; ABC1D23 a 800 km


def test_sem_service_role_falha_com_codigo_2(fake, monkeypatch, capsys):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    assert _executar() == 2
    assert "SUPABASE_SERVICE_ROLE_KEY" in capsys.readouterr().err
