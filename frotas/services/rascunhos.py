"""
Rascunho do checklist em andamento (tabela checklist_rascunhos, um por usuário).

No Streamlit o estado vive na sessão do servidor; se o celular perder a conexão o estado some. As fotos já
estão no Storage e os metadados ficam aqui: ao voltar, o usuário continua de onde parou.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from frotas.infra.erros import ErroNegocio
from frotas.services.base import executar

log = logging.getLogger(__name__)


def carregar_rascunho(client: Any, user_id: str) -> dict[str, Any] | None:
    try:
        linhas = (
            executar(
                client.table("checklist_rascunhos").select("dados, atualizado_em").eq("user_id", user_id).limit(1)
            ).data
            or []
        )
    except ErroNegocio:
        log.warning("Não foi possível carregar o rascunho", exc_info=True)
        return None
    return linhas[0]["dados"] if linhas else None


def salvar_rascunho(client: Any, user_id: str, dados: dict[str, Any]) -> None:
    """Falhas aqui nunca interrompem o preenchimento (o rascunho é conveniência, não requisito)."""
    try:
        executar(
            client.table("checklist_rascunhos").upsert(
                {"user_id": user_id, "dados": dados, "atualizado_em": datetime.now(UTC).isoformat()},
                on_conflict="user_id",
            )
        )
    except ErroNegocio:
        log.warning("Não foi possível salvar o rascunho", exc_info=True)


def apagar_rascunho(client: Any, user_id: str) -> None:
    try:
        executar(client.table("checklist_rascunhos").delete().eq("user_id", user_id))
    except ErroNegocio:
        log.warning("Não foi possível apagar o rascunho", exc_info=True)
