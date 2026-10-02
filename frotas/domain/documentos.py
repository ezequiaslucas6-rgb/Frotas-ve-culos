"""Validadores e normalizadores de documentos brasileiros (sem dependências)."""

from __future__ import annotations

import re
from urllib.parse import quote

PLACA_REGEX = re.compile(r"^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$")


def somente_digitos(valor: str | None) -> str:
    return re.sub(r"\D", "", valor or "")


def _todos_iguais(digitos: str) -> bool:
    return len(set(digitos)) == 1


def cpf_valido(valor: str | None) -> bool:
    """CPF: 11 dígitos + dois dígitos verificadores (módulo 11)."""
    cpf = somente_digitos(valor)
    if len(cpf) != 11 or _todos_iguais(cpf):
        return False

    def digito(tamanho: int) -> int:
        soma = sum(int(cpf[i]) * (tamanho + 1 - i) for i in range(tamanho))
        resto = (soma * 10) % 11
        return 0 if resto == 10 else resto

    return digito(9) == int(cpf[9]) and digito(10) == int(cpf[10])


def cnh_valida(valor: str | None) -> bool:
    """CNH: 11 dígitos + dois dígitos verificadores (algoritmo do DENATRAN)."""
    cnh = somente_digitos(valor)
    if len(cnh) != 11 or _todos_iguais(cnh):
        return False

    soma1 = sum(int(cnh[i]) * (9 - i) for i in range(9))
    dv1 = soma1 % 11
    desconto = 0
    if dv1 >= 10:
        dv1, desconto = 0, 2

    soma2 = sum(int(cnh[i]) * (i + 1) for i in range(9))
    dv2 = (soma2 % 11) - desconto
    if dv2 < 0:
        dv2 += 11
    if dv2 >= 10:
        dv2 = 0

    return dv1 == int(cnh[9]) and dv2 == int(cnh[10])


def normalizar_placa(valor: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", valor or "").upper()


def placa_valida(valor: str | None) -> bool:
    """Placa antiga (ABC1234) ou Mercosul (ABC1D23)."""
    return bool(PLACA_REGEX.match(normalizar_placa(valor)))


def formatar_placa(valor: str | None) -> str:
    placa = normalizar_placa(valor)
    return f"{placa[:3]}-{placa[3:]}" if re.fullmatch(r"[A-Z]{3}[0-9]{4}", placa) else placa


def normalizar_whatsapp(valor: str | None) -> str | None:
    """
    WhatsApp brasileiro. Aceita "(11) 99999-0001", "+55 11 99999-0001", "11999990001"...
    Retorna "55" + DDD + número, ou None se inválido.
    Celular: 9 dígitos começando em 9. Também aceita celular legado de 8 dígitos (6-9).
    """
    digitos = somente_digitos(valor)
    if len(digitos) in (12, 13) and digitos.startswith("55"):
        digitos = digitos[2:]
    if len(digitos) not in (10, 11):
        return None

    ddd, local = digitos[:2], digitos[2:]
    if not re.fullmatch(r"[1-9][1-9]", ddd):
        return None
    if len(local) == 9 and not local.startswith("9"):
        return None
    if len(local) == 8 and not re.match(r"[6-9]", local):
        return None
    return f"55{digitos}"


def link_whatsapp(whatsapp: str, mensagem: str | None = None) -> str:
    """Contato rápido: https://wa.me/<numero>?text=<mensagem>."""
    base = f"https://wa.me/{somente_digitos(whatsapp)}"
    return f"{base}?text={quote(mensagem, safe='')}" if mensagem else base


def formatar_cpf(valor: str | None) -> str:
    d = somente_digitos(valor)[:11]
    if len(d) <= 3:
        return d
    if len(d) <= 6:
        return f"{d[:3]}.{d[3:]}"
    if len(d) <= 9:
        return f"{d[:3]}.{d[3:6]}.{d[6:]}"
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"


def formatar_whatsapp(valor: str | None) -> str:
    d = somente_digitos(valor)
    if d.startswith("55") and len(d) > 11:
        d = d[2:]
    d = d[:11]
    if not d:
        return ""
    if len(d) <= 2:
        return f"({d}"
    if len(d) <= 6:
        return f"({d[:2]}) {d[2:]}"
    if len(d) <= 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    return f"({d[:2]}) {d[2:7]}-{d[7:]}"
