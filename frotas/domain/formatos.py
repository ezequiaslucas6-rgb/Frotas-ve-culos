"""Formatação pt-BR independente de locale do servidor."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from typing import Any

from frotas.domain.dates import FUSO, parse_data, parse_instante
from frotas.domain.documentos import formatar_placa


def numero(valor: float | int) -> str:
    return f"{round(valor):,}".replace(",", ".")


def brl(valor: float | int) -> str:
    inteiro, centavos = f"{float(valor):,.2f}".split(".")
    return f"R$ {inteiro.replace(',', '.')},{centavos}"


def km(valor: int | float) -> str:
    return f"{numero(valor)} km"


def data_br(valor: str | date | None) -> str:
    if not valor:
        return "—"
    return parse_data(valor).strftime("%d/%m/%Y")


def data_hora_br(valor: str | datetime | None) -> str:
    if not valor:
        return "—"
    return parse_instante(valor).astimezone(FUSO).strftime("%d/%m/%Y %H:%M")


def filial_label(f: Mapping[str, Any] | None) -> str:
    return f"{f['nome_cidade']}/{f['uf']}" if f else "—"


def veiculo_label(v: Mapping[str, Any]) -> str:
    modelo = " ".join(str(x) for x in (v.get("marca"), v.get("modelo")) if x)
    return f"{formatar_placa(v['placa'])} · {modelo}" if modelo else formatar_placa(v["placa"])
