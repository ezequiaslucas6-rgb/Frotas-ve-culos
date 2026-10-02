"""Supabase Storage: upload, URLs assinadas (buckets privados) e listagem."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from storage3.exceptions import StorageApiError
from supabase import Client

from frotas.infra.erros import ErroNegocio

log = logging.getLogger(__name__)

BUCKET_VEICULOS = "veiculos"
BUCKET_CHECKLISTS = "checklists"
TTL_URL_PADRAO = 60 * 60  # 1h


def enviar(client: Client, bucket: str, caminho: str, dados: bytes, content_type: str) -> None:
    """Upload (upsert) sob a sessão do usuário: a RLS do Storage exige o caminho <filial_id>/..."""
    try:
        client.storage.from_(bucket).upload(
            caminho, dados, {"content-type": content_type, "upsert": "true", "cache-control": "3600"}
        )
    except StorageApiError as exc:
        log.error("Falha no upload %s/%s: %s", bucket, caminho, exc)
        raise ErroNegocio("Falha no envio do arquivo. Verifique a conexão e tente novamente.") from exc


def listar_nomes(client: Client, bucket: str, pasta: str) -> set[str]:
    """Nomes dos arquivos diretamente dentro de `pasta`."""
    try:
        itens = client.storage.from_(bucket).list(pasta, {"limit": 200})
    except StorageApiError as exc:
        raise ErroNegocio("Não foi possível verificar os arquivos enviados.") from exc
    return {i["name"] for i in itens or [] if i.get("name")}


def urls_assinadas(
    client: Client, bucket: str, caminhos: Iterable[str | None], ttl: int = TTL_URL_PADRAO
) -> dict[str, str]:
    """
    URLs assinadas (buckets privados). A assinatura roda com a sessão do usuário, então a RLS do
    Storage também vale: caminhos de outra filial não são assinados. Retorna {caminho: url}.
    """
    unicos = sorted({c for c in caminhos if c})
    if not unicos:
        return {}
    try:
        itens: list[dict[str, Any]] = client.storage.from_(bucket).create_signed_urls(unicos, ttl)  # type: ignore[assignment]
    except StorageApiError:
        log.warning("Falha ao assinar URLs em %s", bucket, exc_info=True)
        return {}
    return {
        i["path"]: (i.get("signedURL") or i.get("signedUrl"))
        for i in itens
        if i.get("path") and not i.get("error") and (i.get("signedURL") or i.get("signedUrl"))
    }


def remover(client: Client, bucket: str, caminhos: list[str]) -> None:
    if not caminhos:
        return
    try:
        client.storage.from_(bucket).remove(caminhos)
    except StorageApiError:
        log.warning("Falha ao remover arquivos de %s", bucket, exc_info=True)
