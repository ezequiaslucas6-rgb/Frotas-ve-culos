"""Checklist de 14 etapas: upload das fotos, gravação atômica (RPC) e consultas."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from postgrest.exceptions import APIError

from frotas.domain.checklist import CATEGORIAS, ETAPA_POR_CATEGORIA, ETAPAS, SEVERIDADES, caminho_foto, status_geral
from frotas.domain.imagens import ImagemComprimida, ImagemInvalida, comprimir_imagem
from frotas.infra import storage
from frotas.infra.auth import Sessao
from frotas.infra.erros import ErroNegocio, traduzir_erro_api
from frotas.services.alertas import sincronizar_sem_falhar
from frotas.services.base import buscar_por_ids, eh_uuid, executar, intervalo

log = logging.getLogger(__name__)

MAX_MARCADORES = 20


@dataclass(frozen=True)
class ItemChecklist:
    categoria: str
    foto_path: str
    severidade: str
    observacao: str | None = None
    marcadores: tuple[dict[str, float], ...] = ()


@dataclass(frozen=True)
class EntradaChecklist:
    checklist_id: str
    veiculo_id: str
    motorista_id: str
    km_atual: int
    itens: tuple[ItemChecklist, ...]
    observacoes_gerais: str | None = None


@dataclass(frozen=True)
class ResultadoChecklist:
    id: str
    status: str


def enviar_foto_etapa(
    sessao: Sessao, filial_id: str, checklist_id: str, categoria: str, bruto: bytes
) -> tuple[str, ImagemComprimida]:
    """
    Comprime a foto (JPEG ~1600 px) e envia ao Storage em <filial>/<checklist>/<categoria>.jpg.
    O upload é feito etapa a etapa (não só no final): uma queda de conexão não perde as fotos já enviadas.
    """
    if categoria not in ETAPA_POR_CATEGORIA:
        raise ErroNegocio("Etapa inválida.")
    try:
        img = comprimir_imagem(bruto, max_lado=1600, qualidade=80)
    except ImagemInvalida as exc:
        raise ErroNegocio(str(exc)) from exc
    caminho = caminho_foto(filial_id, checklist_id, categoria)
    storage.enviar(sessao.client, storage.BUCKET_CHECKLISTS, caminho, img.dados, "image/jpeg")
    return caminho, img


def validar_entrada(e: EntradaChecklist) -> None:
    for nome, valor in (("checklist", e.checklist_id), ("veículo", e.veiculo_id), ("motorista", e.motorista_id)):
        if not eh_uuid(valor):
            raise ErroNegocio(f"Identificador de {nome} inválido.")
    if e.km_atual < 0:
        raise ErroNegocio("KM inválido.")
    categorias = [i.categoria for i in e.itens]
    if len(e.itens) != len(CATEGORIAS) or set(categorias) != set(CATEGORIAS):
        raise ErroNegocio(f"O checklist exige as {len(CATEGORIAS)} fotos obrigatórias (uma por etapa).")
    for item in e.itens:
        if item.severidade not in SEVERIDADES:
            raise ErroNegocio("Severidade inválida.")
        if item.severidade != "ok" and not (item.observacao or "").strip():
            raise ErroNegocio("Descreva a inconformidade nos itens marcados como Atenção ou Avaria.")
        if len(item.marcadores) > MAX_MARCADORES or any(
            not (0 <= m.get("x", -1) <= 100 and 0 <= m.get("y", -1) <= 100) for m in item.marcadores
        ):
            raise ErroNegocio("Marcadores de avaria inválidos.")


def salvar_checklist(sessao: Sessao, e: EntradaChecklist) -> ResultadoChecklist:
    """
    1. valida o payload e as 14 categorias
    2. confere veículo/motorista com a sessão do usuário (RLS) e a mesma filial
    3. garante que cada foto está no caminho esperado e EXISTE no Storage
    4. chama a RPC atômica salvar_checklist (checklist + 14 fotos + KM, numa transação;
       o status geral é derivado no banco)
    5. recalcula os alertas de manutenção do veículo (o KM novo pode vencer a revisão)
    """
    client = sessao.client
    validar_entrada(e)
    status = status_geral(i.severidade for i in e.itens)

    achados_v = (
        executar(client.table("veiculos").select("id, filial_id, km_atual").eq("id", e.veiculo_id).limit(1)).data or []
    )
    achados_m = (
        executar(client.table("motoristas").select("id, filial_id, status").eq("id", e.motorista_id).limit(1)).data
        or []
    )
    if not achados_v:
        raise ErroNegocio("Veículo não encontrado.")
    if not achados_m:
        raise ErroNegocio("Motorista não encontrado.")
    veiculo, motorista = achados_v[0], achados_m[0]
    if motorista["filial_id"] != veiculo["filial_id"]:
        raise ErroNegocio("O motorista e o veículo pertencem a filiais diferentes.")
    if motorista["status"] != "ativo":
        raise ErroNegocio("O motorista selecionado não está ativo.")
    if e.km_atual < veiculo["km_atual"]:
        raise ErroNegocio(f"O KM informado é menor que o último registrado ({veiculo['km_atual']} km).")

    for item in e.itens:
        if item.foto_path != caminho_foto(veiculo["filial_id"], e.checklist_id, item.categoria):
            raise ErroNegocio("Caminho de foto inválido. Refaça a captura da etapa.")
    enviados = storage.listar_nomes(client, storage.BUCKET_CHECKLISTS, f"{veiculo['filial_id']}/{e.checklist_id}")
    for item in e.itens:
        if f"{item.categoria}.jpg" not in enviados:
            raise ErroNegocio(
                f'A foto da etapa "{ETAPA_POR_CATEGORIA[item.categoria].titulo}" não foi encontrada. Refaça a captura.'
            )

    fotos = [
        {
            "categoria_foto": i.categoria,
            "foto_url": i.foto_path,
            "severidade": i.severidade,
            "observacao": None if i.severidade == "ok" else (i.observacao or "").strip()[:1000],
            "marcadores": [{"x": m["x"], "y": m["y"]} for m in i.marcadores],
        }
        for i in e.itens
    ]
    try:
        client.rpc(
            "salvar_checklist",
            {
                "p_id": e.checklist_id,
                "p_veiculo_id": e.veiculo_id,
                "p_motorista_id": e.motorista_id,
                "p_observacoes": (e.observacoes_gerais or "").strip()[:2000] or None,
                "p_km": e.km_atual,
                "p_fotos": fotos,
            },
        ).execute()
    except APIError as exc:
        # reenvio (duplo clique / retry de rede): a PK já existe => sucesso idempotente
        if str(getattr(exc, "code", "")) != "23505":
            raise ErroNegocio(traduzir_erro_api(exc)) from exc

    sincronizar_sem_falhar(client, e.veiculo_id)
    return ResultadoChecklist(e.checklist_id, status)


def listar_checklists(
    client: Any, filial_id: str | None = None, status: str | None = None, pagina: int = 1, tamanho: int = 20
) -> tuple[list[dict[str, Any]], int]:
    de, ate = intervalo(pagina, tamanho)
    q = client.table("checklists").select("*", count="exact").order("data_envio", desc=True).range(de, ate)
    if filial_id:
        q = q.eq("filial_id", filial_id)
    if status in SEVERIDADES:
        q = q.eq("status", status)
    resp = executar(q)
    return anexar_referencias(client, resp.data or []), resp.count or 0


def anexar_referencias(client: Any, checklists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Acrescenta veiculo / motorista / filial a cada checklist (lookups em lote)."""
    veiculos = buscar_por_ids(client, "veiculos", [c["veiculo_id"] for c in checklists], "id, placa, marca, modelo")
    motoristas = buscar_por_ids(client, "motoristas", [c["motorista_id"] for c in checklists], "id, nome, whatsapp")
    filiais = buscar_por_ids(client, "filiais", [c["filial_id"] for c in checklists], "id, nome_cidade, uf")
    return [
        {
            **c,
            "veiculo": veiculos.get(c["veiculo_id"]),
            "motorista": motoristas.get(c["motorista_id"]),
            "filial": filiais.get(c["filial_id"]),
        }
        for c in checklists
    ]


def obter_checklist(client: Any, checklist_id: str) -> dict[str, Any] | None:
    """Checklist completo: referências, quem registrou, fotos (na ordem das etapas) com URL assinada."""
    linhas = executar(client.table("checklists").select("*").eq("id", checklist_id).limit(1)).data or []
    if not linhas:
        return None
    c = anexar_referencias(client, linhas)[0]
    supervisor = buscar_por_ids(client, "profiles", [c["supervisor_id"]], "id, nome").get(c["supervisor_id"])
    fotos = executar(client.table("checklist_fotos").select("*").eq("checklist_id", checklist_id)).data or []
    urls = storage.urls_assinadas(client, storage.BUCKET_CHECKLISTS, [f["foto_url"] for f in fotos])
    por_categoria = {f["categoria_foto"]: {**f, "url": urls.get(f["foto_url"])} for f in fotos}
    return {
        **c,
        "supervisor_nome": supervisor["nome"] if supervisor else None,
        "fotos": [(etapa, por_categoria.get(etapa.categoria)) for etapa in ETAPAS],
    }


def excluir_checklist(sessao: Sessao, checklist_id: str) -> None:
    """Exclusão (somente admin): remove as fotos do Storage e o checklist (fotos em cascata)."""
    sessao.exigir_admin()
    client = sessao.client
    caminhos = [
        f["foto_url"]
        for f in executar(client.table("checklist_fotos").select("foto_url").eq("checklist_id", checklist_id)).data
        or []
    ]
    removidos = executar(client.table("checklists").delete().eq("id", checklist_id)).data
    if not removidos:
        raise ErroNegocio("Checklist não encontrado.")
    storage.remover(client, storage.BUCKET_CHECKLISTS, caminhos)
