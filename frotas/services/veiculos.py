from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from frotas.domain.dates import hoje, somar_dias
from frotas.domain.imagens import ImagemInvalida, comprimir_imagem
from frotas.infra import storage
from frotas.infra.auth import Sessao
from frotas.infra.erros import ErroNegocio, ErroValidacao
from frotas.services.alertas import sincronizar_sem_falhar
from frotas.services.base import executar, novo_uuid
from frotas.services.validacao import validar_veiculo

log = logging.getLogger(__name__)
MAX_PDF_BYTES = 10 * 1024 * 1024


@dataclass(frozen=True)
class Arquivo:
    """Arquivo recebido do navegador (st.file_uploader / st.camera_input)."""

    dados: bytes
    mime: str


def _preparar(arquivo: Arquivo, *, documento: bool) -> tuple[bytes, str, str]:
    """Devolve (bytes, content_type, extensão). Imagens são comprimidas; PDF sobe como está."""
    if arquivo.mime == "application/pdf":
        if not documento:
            raise ErroNegocio("Este campo aceita apenas imagem.")
        if len(arquivo.dados) > MAX_PDF_BYTES:
            raise ErroNegocio("PDF acima de 10 MB.")
        return arquivo.dados, "application/pdf", "pdf"
    try:
        img = comprimir_imagem(arquivo.dados, max_lado=2200 if documento else 1600, qualidade=82)
    except ImagemInvalida as exc:
        raise ErroNegocio(str(exc)) from exc
    return img.dados, "image/jpeg", "jpg"


def salvar_veiculo(
    sessao: Sessao,
    dados: dict[str, Any],
    veiculo_id: str | None = None,
    *,
    foto: Arquivo | None = None,
    documento: Arquivo | None = None,
    remover_foto: bool = False,
    remover_documento: bool = False,
) -> str:
    """Cria/edita um veículo (e envia foto geral/documento ao Storage). Devolve o id."""
    v = validar_veiculo(dados)
    client = sessao.client
    edicao = veiculo_id is not None

    if veiculo_id:  # a filial vem do PRÓPRIO veículo (nunca do formulário)
        atuais = (
            executar(
                client.table("veiculos")
                .select("id, filial_id, foto_geral_url, documento_url")
                .eq("id", veiculo_id)
                .limit(1)
            ).data
            or []
        )
        if not atuais:
            raise ErroNegocio("Veículo não encontrado.")
        atual = atuais[0]
        filial_id, foto_path, doc_path = atual["filial_id"], atual["foto_geral_url"], atual["documento_url"]
    else:
        filial_id = sessao.filial_alvo(dados.get("filial_id"))
        if not filial_id:
            raise ErroValidacao({"filial_id": "Selecione a filial."})
        veiculo_id, foto_path, doc_path = novo_uuid(), None, None

    enviados: list[str] = []
    try:
        if foto:
            bytes_, mime, ext = _preparar(foto, documento=False)
            foto_path = f"{filial_id}/veiculos/{veiculo_id}/foto-geral.{ext}"
            storage.enviar(client, storage.BUCKET_VEICULOS, foto_path, bytes_, mime)
            enviados.append(foto_path)
        elif remover_foto:
            foto_path = None
        if documento:
            bytes_, mime, ext = _preparar(documento, documento=True)
            doc_path = f"{filial_id}/veiculos/{veiculo_id}/documento.{ext}"
            storage.enviar(client, storage.BUCKET_VEICULOS, doc_path, bytes_, mime)
            enviados.append(doc_path)
        elif remover_documento:
            doc_path = None

        registro = {
            "placa": v["placa"],
            "marca": v["marca"],
            "modelo": v["modelo"],
            "ano": v["ano"],
            "km_atual": v["km_atual"],
            "intervalo_revisao_km": v["intervalo_revisao_km"],
            "intervalo_revisao_dias": v["intervalo_revisao_dias"],
            "foto_geral_url": foto_path,
            "documento_url": doc_path,
        }
        if edicao:
            registro["proxima_revisao_km"] = v["proxima_revisao_km"]
            registro["proxima_revisao_data"] = (
                v["proxima_revisao_data"].isoformat() if v["proxima_revisao_data"] else None
            )
            executar(client.table("veiculos").update(registro).eq("id", veiculo_id))
        else:
            # Novo veículo: sem plano informado, o 1º vencimento parte do KM/data de hoje + intervalos.
            prox_km = (
                v["proxima_revisao_km"]
                if v["proxima_revisao_km"] is not None
                else v["km_atual"] + v["intervalo_revisao_km"]
            )
            prox_data = v["proxima_revisao_data"] or somar_dias(hoje(), v["intervalo_revisao_dias"])
            executar(
                client.table("veiculos").insert(
                    {
                        **registro,
                        "id": veiculo_id,
                        "filial_id": filial_id,
                        "proxima_revisao_km": prox_km,
                        "proxima_revisao_data": prox_data.isoformat(),
                    }
                )
            )
    except ErroNegocio:
        storage.remover(client, storage.BUCKET_VEICULOS, enviados)  # melhor esforço
        raise

    if edicao:
        sincronizar_sem_falhar(client, veiculo_id)
    return veiculo_id


def excluir_veiculo(sessao: Sessao, veiculo_id: str) -> None:
    sessao.exigir_admin()
    try:
        removidos = executar(sessao.client.table("veiculos").delete().eq("id", veiculo_id)).data
    except ErroNegocio as exc:
        raise ErroNegocio(
            "O veículo possui checklists ou manutenções no histórico e não pode ser excluído."
            if "vinculados" in exc.mensagem
            else exc.mensagem
        ) from exc
    if not removidos:
        raise ErroNegocio("Veículo não encontrado.")


def obter_veiculo_tabela(client: Any, veiculo_id: str) -> dict[str, Any] | None:
    linhas = executar(client.table("veiculos").select("*").eq("id", veiculo_id).limit(1)).data or []
    return linhas[0] if linhas else None
