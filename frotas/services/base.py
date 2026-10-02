"""Utilitários compartilhados pelos serviços."""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from typing import Any, TypeVar

from postgrest.exceptions import APIError

from frotas.infra.erros import ErroNegocio, traduzir_erro_api

T = TypeVar("T")
TAMANHO_PAGINA = 20


def executar(builder: Any) -> Any:
    """Executa uma query do postgrest-py traduzindo APIError em ErroNegocio (mensagem amigável)."""
    try:
        return builder.execute()
    except APIError as exc:
        raise ErroNegocio(traduzir_erro_api(exc)) from exc


def em_lotes(valores: Sequence[T], tamanho: int = 100) -> Iterator[Sequence[T]]:
    for i in range(0, len(valores), tamanho):
        yield valores[i : i + tamanho]


def buscar_por_ids(
    client: Any, tabela: str, ids: Iterable[str | None], colunas: str = "*"
) -> dict[str, dict[str, Any]]:
    """Lookup em lote (evita embeds do PostgREST): {id: linha}. A RLS do usuário continua valendo."""
    unicos = sorted({i for i in ids if i})
    achados: dict[str, dict[str, Any]] = {}
    for lote in em_lotes(unicos):
        for linha in executar(client.table(tabela).select(colunas).in_("id", list(lote))).data or []:
            achados[linha["id"]] = linha
    return achados


def sanitizar_busca(texto: str | None) -> str:
    """Remove caracteres com significado na sintaxe de filtros do PostgREST (or/ilike)."""
    return re.sub(r"[,()*%\\:]", " ", texto or "").strip()[:60]


def eh_uuid(valor: object) -> bool:
    try:
        uuid.UUID(str(valor))
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def novo_uuid() -> str:
    return str(uuid.uuid4())


@dataclass(frozen=True)
class Pagina:
    itens: list[dict[str, Any]]
    total: int
    pagina: int
    tamanho: int = TAMANHO_PAGINA

    @property
    def paginas(self) -> int:
        return max(1, -(-self.total // self.tamanho))


def intervalo(pagina: int, tamanho: int = TAMANHO_PAGINA) -> tuple[int, int]:
    """Faixa [de, até] (inclusiva) para .range()."""
    pagina = max(1, pagina)
    return (pagina - 1) * tamanho, pagina * tamanho - 1
