"""Datas de calendário no fuso do negócio (independe do fuso do servidor)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Sao_Paulo")


def hoje() -> date:
    """Data de hoje em America/Sao_Paulo."""
    return datetime.now(FUSO).date()


def parse_data(valor: str | date) -> date:
    """'2026-03-10' (ou '2026-03-10T..') -> date."""
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    return date.fromisoformat(valor[:10])


def parse_instante(valor: str | datetime) -> datetime:
    """timestamptz do Postgres ('2026-03-10T12:00:00+00:00' / '...Z') -> datetime com fuso."""
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=FUSO)
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def data_do_instante(valor: str | datetime) -> date:
    """Dia (no fuso do negócio) em que o instante ocorreu."""
    return parse_instante(valor).astimezone(FUSO).date()


def dias_entre(a: date, b: date) -> int:
    """b - a, em dias inteiros."""
    return (b - a).days


def somar_dias(d: date, dias: int) -> date:
    return d + timedelta(days=dias)
