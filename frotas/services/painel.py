"""Leitura do painel de veículos (view vw_veiculos_painel) com a saúde da frota já avaliada."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from frotas.domain.alertas import AvaliacaoVeiculo, avaliar_veiculo_painel
from frotas.domain.dates import hoje
from frotas.services.base import Pagina, executar, intervalo, sanitizar_busca

VIEW = "vw_veiculos_painel"
_LIMITE_TOTAL = 1000  # teto do PostgREST/Supabase por requisição


@dataclass(frozen=True)
class VeiculoPainel:
    dados: dict[str, Any]
    avaliacao: AvaliacaoVeiculo

    @property
    def id(self) -> str:
        return self.dados["id"]


def _enriquecer(linhas: list[dict[str, Any]]) -> list[VeiculoPainel]:
    h = hoje()
    return [VeiculoPainel(v, avaliar_veiculo_painel(v, h)) for v in linhas]


def listar_veiculos(
    client: Any, filial_id: str | None = None, busca: str | None = None, pagina: int = 1, tamanho: int = 20
) -> tuple[list[VeiculoPainel], int]:
    de, ate = intervalo(pagina, tamanho)
    q = client.table(VIEW).select("*", count="exact").order("placa").range(de, ate)
    if filial_id:
        q = q.eq("filial_id", filial_id)
    termo = sanitizar_busca(busca)
    if termo:
        q = q.or_(f"placa.ilike.%{termo}%,modelo.ilike.%{termo}%,marca.ilike.%{termo}%")
    resp = executar(q)
    return _enriquecer(resp.data or []), resp.count or 0


def todos_veiculos(client: Any, filial_id: str | None = None) -> list[VeiculoPainel]:
    """Toda a frota visível (até 1.000 veículos) — usado pelo painel executivo e seletores."""
    q = client.table(VIEW).select("*").order("placa").range(0, _LIMITE_TOTAL - 1)
    if filial_id:
        q = q.eq("filial_id", filial_id)
    return _enriquecer(executar(q).data or [])


def obter_veiculo(client: Any, veiculo_id: str) -> VeiculoPainel | None:
    linhas = executar(client.table(VIEW).select("*").eq("id", veiculo_id).limit(1)).data or []
    return _enriquecer(linhas)[0] if linhas else None


def como_pagina(itens: list[dict[str, Any]], total: int, pagina: int, tamanho: int) -> Pagina:
    return Pagina(itens, total, pagina, tamanho)
