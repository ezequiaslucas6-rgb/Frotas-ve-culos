from __future__ import annotations

from collections import Counter
from typing import Any

from frotas.infra.auth import Sessao
from frotas.infra.erros import ErroNegocio
from frotas.services.base import executar
from frotas.services.validacao import validar_filial


def listar_filiais(client: Any) -> list[dict[str, Any]]:
    """Filiais visíveis (RLS): o admin vê todas; o supervisor, só a própria."""
    return executar(client.table("filiais").select("*").order("nome_cidade")).data or []


def contar_veiculos_por_filial(client: Any) -> Counter[str]:
    linhas = executar(client.table("veiculos").select("filial_id").range(0, 999)).data or []
    return Counter(v["filial_id"] for v in linhas)


def salvar_filial(sessao: Sessao, dados: dict[str, Any], filial_id: str | None = None) -> None:
    sessao.exigir_admin()
    valores = validar_filial(dados)
    tabela = sessao.client.table("filiais")
    resp = executar(tabela.update(valores).eq("id", filial_id) if filial_id else tabela.insert(valores))
    if filial_id and not resp.data:
        raise ErroNegocio("Filial não encontrada.")


def excluir_filial(sessao: Sessao, filial_id: str) -> None:
    sessao.exigir_admin()
    try:
        removidas = executar(sessao.client.table("filiais").delete().eq("id", filial_id)).data
    except ErroNegocio as exc:
        raise ErroNegocio(
            "Não é possível excluir: a filial possui veículos, motoristas ou usuários vinculados."
            if "vinculados" in exc.mensagem
            else exc.mensagem
        ) from exc
    if not removidas:
        raise ErroNegocio("Filial não encontrada.")
