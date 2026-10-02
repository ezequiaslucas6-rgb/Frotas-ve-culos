from __future__ import annotations

from typing import Any

from frotas.domain.documentos import somente_digitos
from frotas.infra.auth import Sessao
from frotas.infra.erros import ErroNegocio, ErroValidacao
from frotas.services.base import buscar_por_ids, executar, intervalo, sanitizar_busca
from frotas.services.validacao import validar_motorista


def listar_motoristas(
    client: Any, filial_id: str | None = None, busca: str | None = None, pagina: int = 1, tamanho: int = 20
) -> tuple[list[dict[str, Any]], int]:
    de, ate = intervalo(pagina, tamanho)
    q = client.table("motoristas").select("*", count="exact").order("nome").range(de, ate)
    if filial_id:
        q = q.eq("filial_id", filial_id)
    termo = sanitizar_busca(busca)
    if termo:
        digitos = somente_digitos(termo)
        q = q.or_(f"nome.ilike.%{termo}%,email.ilike.%{termo}%,cpf.ilike.%{digitos or termo}%")
    resp = executar(q)
    linhas = resp.data or []
    filiais = buscar_por_ids(client, "filiais", [m["filial_id"] for m in linhas], "id, nome_cidade, uf")
    return [{**m, "filial": filiais.get(m["filial_id"])} for m in linhas], resp.count or 0


def listar_ativos(client: Any, filial_id: str | None = None) -> list[dict[str, Any]]:
    q = client.table("motoristas").select("id, filial_id, nome").eq("status", "ativo").order("nome").range(0, 999)
    if filial_id:
        q = q.eq("filial_id", filial_id)
    return executar(q).data or []


def obter_motorista(client: Any, motorista_id: str) -> dict[str, Any] | None:
    linhas = executar(client.table("motoristas").select("*").eq("id", motorista_id).limit(1)).data or []
    return linhas[0] if linhas else None


def salvar_motorista(sessao: Sessao, dados: dict[str, Any], motorista_id: str | None = None) -> None:
    valores = validar_motorista(dados)
    if motorista_id:
        # edição: a filial nunca é alterada (e a RLS barra qualquer acesso a outra filial)
        if not executar(sessao.client.table("motoristas").update(valores).eq("id", motorista_id)).data:
            raise ErroNegocio("Motorista não encontrado.")
        return
    filial_id = sessao.filial_alvo(dados.get("filial_id"))
    if not filial_id:
        raise ErroValidacao({"filial_id": "Selecione a filial."})
    executar(sessao.client.table("motoristas").insert({**valores, "filial_id": filial_id}))


def excluir_motorista(sessao: Sessao, motorista_id: str) -> None:
    sessao.exigir_admin()
    try:
        removidos = executar(sessao.client.table("motoristas").delete().eq("id", motorista_id)).data
    except ErroNegocio as exc:
        raise ErroNegocio(
            'O motorista possui checklists no histórico. Para desligá-lo, altere o status para "Inativo".'
            if "vinculados" in exc.mensagem
            else exc.mensagem
        ) from exc
    if not removidos:
        raise ErroNegocio("Motorista não encontrado.")
