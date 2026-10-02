"""Validação e normalização dos formulários (server-side; nunca confie no navegador)."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import date
from typing import Any

from frotas.domain.dates import hoje, parse_data
from frotas.domain.documentos import (
    cnh_valida,
    cpf_valido,
    normalizar_placa,
    normalizar_whatsapp,
    placa_valida,
    somente_digitos,
)
from frotas.infra.erros import ErroValidacao
from frotas.services.base import eh_uuid

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
STATUS_MOTORISTA = ("ativo", "ferias", "afastado", "inativo")


def _texto(d: Mapping[str, Any], campo: str) -> str:
    return str(d.get(campo) or "").strip()


def _int(
    d: Mapping[str, Any], campo: str, *, minimo: int, maximo: int = 2_000_000_000
) -> tuple[int | None, str | None]:
    bruto = d.get(campo)
    if bruto is None or (isinstance(bruto, str) and not bruto.strip()):
        return None, None
    try:
        if isinstance(bruto, float) and not bruto.is_integer():
            raise ValueError
        n = int(float(bruto)) if not isinstance(bruto, int) else bruto
    except (TypeError, ValueError):
        return None, "Informe um número inteiro."
    if n < minimo:
        return None, f"Mínimo {minimo}."
    if n > maximo:
        return None, "Valor muito alto."
    return n, None


def _data(d: Mapping[str, Any], campo: str) -> tuple[date | None, str | None]:
    bruto = d.get(campo)
    if bruto in (None, ""):
        return None, None
    try:
        return parse_data(bruto), None
    except (ValueError, TypeError):
        return None, "Data inválida."


def _levantar(erros: dict[str, str]) -> None:
    if erros:
        raise ErroValidacao(erros)


def validar_filial(d: Mapping[str, Any]) -> dict[str, Any]:
    erros: dict[str, str] = {}
    cidade, uf = _texto(d, "nome_cidade"), _texto(d, "uf").upper()
    if len(cidade) < 2:
        erros["nome_cidade"] = "Informe a cidade."
    if not re.fullmatch(r"[A-Z]{2}", uf):
        erros["uf"] = "UF inválida (use 2 letras)."
    _levantar(erros)
    return {"nome_cidade": cidade[:80], "uf": uf}


def validar_supervisor(d: Mapping[str, Any]) -> dict[str, Any]:
    erros: dict[str, str] = {}
    nome, email, senha = _texto(d, "nome"), _texto(d, "email").lower(), str(d.get("senha") or "")
    if len(nome) < 2:
        erros["nome"] = "Informe o nome."
    if not _EMAIL.match(email):
        erros["email"] = "E-mail inválido."
    if len(senha) < 8:
        erros["senha"] = "A senha deve ter ao menos 8 caracteres."
    if not eh_uuid(d.get("filial_id")):
        erros["filial_id"] = "Selecione a filial."
    _levantar(erros)
    return {"nome": nome[:120], "email": email, "senha": senha, "filial_id": str(d["filial_id"])}


def validar_motorista(d: Mapping[str, Any]) -> dict[str, Any]:
    erros: dict[str, str] = {}
    nome, email = _texto(d, "nome"), _texto(d, "email").lower()
    whatsapp = normalizar_whatsapp(_texto(d, "whatsapp"))
    status = _texto(d, "status") or "ativo"
    if len(nome) < 2:
        erros["nome"] = "Informe o nome completo."
    if not cpf_valido(_texto(d, "cpf")):
        erros["cpf"] = "CPF inválido."
    if not cnh_valida(_texto(d, "cnh")):
        erros["cnh"] = "CNH inválida."
    if not _EMAIL.match(email):
        erros["email"] = "E-mail inválido."
    if not whatsapp:
        erros["whatsapp"] = "WhatsApp inválido. Use DDD + número."
    if status not in STATUS_MOTORISTA:
        erros["status"] = "Status inválido."
    _levantar(erros)
    return {
        "nome": nome[:120],
        "cpf": somente_digitos(_texto(d, "cpf")),
        "cnh": somente_digitos(_texto(d, "cnh")),
        "email": email,
        "whatsapp": whatsapp,
        "status": status,
    }


def validar_veiculo(d: Mapping[str, Any]) -> dict[str, Any]:
    erros: dict[str, str] = {}
    placa = normalizar_placa(_texto(d, "placa"))
    if not placa_valida(placa):
        erros["placa"] = "Placa inválida (ex.: ABC1D23 ou ABC-1234)."
    ano, e = _int(d, "ano", minimo=1950, maximo=2100)
    if e:
        erros["ano"] = e
    km_atual, e = _int(d, "km_atual", minimo=0)
    if e or km_atual is None:
        erros["km_atual"] = e or "Informe o KM atual."
    intervalo_km, e = _int(d, "intervalo_revisao_km", minimo=1)
    if e or intervalo_km is None:
        erros["intervalo_revisao_km"] = e or "Informe o intervalo em KM."
    intervalo_dias, e = _int(d, "intervalo_revisao_dias", minimo=1)
    if e or intervalo_dias is None:
        erros["intervalo_revisao_dias"] = e or "Informe o intervalo em dias."
    prox_km, e = _int(d, "proxima_revisao_km", minimo=0)
    if e:
        erros["proxima_revisao_km"] = e
    prox_data, e = _data(d, "proxima_revisao_data")
    if e:
        erros["proxima_revisao_data"] = e
    _levantar(erros)
    return {
        "placa": placa,
        "marca": _texto(d, "marca")[:60] or None,
        "modelo": _texto(d, "modelo")[:60] or None,
        "ano": ano,
        "km_atual": km_atual,
        "intervalo_revisao_km": intervalo_km,
        "intervalo_revisao_dias": intervalo_dias,
        "proxima_revisao_km": prox_km,
        "proxima_revisao_data": prox_data,
    }


def _moeda(bruto: Any) -> float | None:
    """Aceita 1234.5, '1234.50' e '1.234,50' (pt-BR)."""
    if isinstance(bruto, int | float):
        return float(bruto)
    texto = str(bruto or "").strip().replace("R$", "").replace(" ", "")
    if not texto:
        return None
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return None


def validar_manutencao(d: Mapping[str, Any]) -> dict[str, Any]:
    erros: dict[str, str] = {}
    if not eh_uuid(d.get("veiculo_id")):
        erros["veiculo_id"] = "Selecione o veículo."
    tipo = _texto(d, "tipo")
    if tipo not in ("preventiva", "corretiva"):
        erros["tipo"] = "Selecione o tipo."
    descricao = _texto(d, "descricao")
    if len(descricao) < 3:
        erros["descricao"] = "Descreva o serviço realizado."
    custo = _moeda(d.get("custo"))
    if custo is None:
        erros["custo"] = "Informe o custo (use 0 se não houve)."
    elif custo < 0:
        erros["custo"] = "O custo não pode ser negativo."
    elif custo > 99_999_999:
        erros["custo"] = "Valor muito alto."
    km, e = _int(d, "km_registro", minimo=0)
    if e or km is None:
        erros["km_registro"] = e or "Informe o KM."
    data, e = _data(d, "data_manutencao")
    if e or data is None:
        erros["data_manutencao"] = e or "Informe a data."
    elif data > hoje():
        erros["data_manutencao"] = "A data não pode ser futura."
    _levantar(erros)
    return {
        "veiculo_id": str(d["veiculo_id"]),
        "tipo": tipo,
        "descricao": descricao[:1000],
        "custo": round(custo or 0.0, 2),
        "km_registro": km,
        "data_manutencao": data,
        "fornecedor": _texto(d, "fornecedor")[:120] or None,
    }
