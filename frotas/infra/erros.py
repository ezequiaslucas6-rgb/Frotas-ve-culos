"""Erros de negócio e tradução de erros do Postgres/PostgREST em mensagens amigáveis."""

from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)


class ErroNegocio(Exception):
    """Erro esperado, com mensagem segura para exibir ao usuário."""

    def __init__(self, mensagem: str):
        super().__init__(mensagem)
        self.mensagem = mensagem


class ErroValidacao(ErroNegocio):
    """Campos inválidos: `campos` mapeia nome do campo -> mensagem."""

    def __init__(self, campos: dict[str, str], mensagem: str = "Corrija os campos destacados."):
        super().__init__(mensagem)
        self.campos = campos


_UNICIDADE = {
    "veiculos_placa_key": "Já existe um veículo cadastrado com esta placa.",
    "motoristas_filial_id_cpf_key": "Já existe um motorista com este CPF nesta filial.",
    "filiais_nome_cidade_uf_key": "Esta filial já está cadastrada.",
}


def traduzir_erro_api(erro: Exception) -> str:
    """Traduz postgrest.exceptions.APIError (sem vazar detalhes internos)."""
    codigo = str(getattr(erro, "code", "") or "")
    texto = f"{getattr(erro, 'message', '')} {getattr(erro, 'details', '') or ''}"

    if codigo == "23505":
        for constraint, mensagem in _UNICIDADE.items():
            if constraint in texto:
                return mensagem
        return "Já existe um registro com estes dados."
    if codigo == "23503":
        return "Não é possível concluir: há registros vinculados (histórico) ou a referência é inválida."
    if codigo == "23514":
        return "Algum dos valores informados não é aceito."
    if codigo == "42501" or re.search(r"row-level security", texto, re.I):
        return "Você não tem permissão para realizar esta operação."
    if codigo in ("PGRST301", "PGRST303") or re.search(r"JWT", texto):
        return "Sua sessão expirou. Entre novamente."
    log.error("Erro de API não mapeado: code=%s msg=%s", codigo, texto.strip())
    return "Não foi possível concluir a operação. Tente novamente."
