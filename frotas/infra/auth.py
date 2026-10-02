"""
Autenticação (Supabase Auth) e perfil/RBAC do usuário — sem dependência do Streamlit.

`Sessao` agrupa o cliente autenticado (JWT do usuário => RLS) com o perfil (role/filial).
A persistência entre recarregamentos de página (cookie) fica em ui/sessao.py.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from postgrest.exceptions import APIError
from supabase import Client
from supabase_auth.errors import AuthError

from frotas.infra.cliente import criar_cliente_usuario
from frotas.infra.config import Config
from frotas.infra.erros import ErroNegocio

log = logging.getLogger(__name__)

MARGEM_RENOVACAO_S = 120


class SemPerfil(ErroNegocio):
    """Usuário existe no Auth mas ainda não tem registro em public.profiles."""


@dataclass
class Perfil:
    id: str
    nome: str
    role: str  # 'admin' | 'supervisor'
    filial_id: str | None
    filial: dict[str, Any] | None = None


@dataclass
class Sessao:
    client: Client
    user_id: str
    email: str
    perfil: Perfil
    refresh_token: str
    expires_at: int
    _extra: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def is_admin(self) -> bool:
        return self.perfil.role == "admin"

    @property
    def filial_id(self) -> str | None:
        return self.perfil.filial_id

    def exigir_admin(self) -> None:
        """Barra operações exclusivas do Administrador Geral (a RLS continua sendo a barreira final)."""
        if not self.is_admin:
            raise ErroNegocio("Você não tem permissão para realizar esta operação.")

    def filial_alvo(self, solicitada: str | None) -> str | None:
        """
        Filial-alvo de uma escrita. Supervisor: SEMPRE a própria (ignora o valor vindo do formulário).
        Admin: a filial informada.
        """
        return self.filial_id if not self.is_admin else (solicitada or None)

    def escopo_filial(self, filtro_admin: str | None = None) -> str | None:
        """Filial usada para filtrar listagens: supervisor => a dele; admin => filtro opcional."""
        return self.filial_id if not self.is_admin else filtro_admin


def _carregar_perfil(client: Client, user_id: str) -> Perfil:
    try:
        linhas = client.table("profiles").select("id, nome, role, filial_id").eq("id", user_id).limit(1).execute().data
        if not linhas:
            raise SemPerfil("Seu usuário ainda não foi habilitado. Fale com o administrador.")
        p = linhas[0]
        filial = None
        if p.get("filial_id"):
            achadas = (
                client.table("filiais").select("id, nome_cidade, uf").eq("id", p["filial_id"]).limit(1).execute().data
            )
            filial = achadas[0] if achadas else None
        return Perfil(id=p["id"], nome=p["nome"], role=p["role"], filial_id=p.get("filial_id"), filial=filial)
    except APIError as exc:
        log.error("Falha ao carregar perfil: %s", exc)
        raise ErroNegocio("Não foi possível carregar seu perfil. Tente novamente.") from exc


def _montar_sessao(client: Client, session: Any) -> Sessao:
    try:
        perfil = _carregar_perfil(client, session.user.id)
    except ErroNegocio:
        _sair_silencioso(client)
        raise
    return Sessao(
        client=client,
        user_id=session.user.id,
        email=session.user.email or "",
        perfil=perfil,
        refresh_token=session.refresh_token,
        expires_at=int(session.expires_at or (time.time() + 3600)),
    )


def _sair_silencioso(client: Client) -> None:
    try:
        client.auth.sign_out()
    except Exception:
        log.debug("sign_out falhou", exc_info=True)


def entrar(config: Config, email: str, senha: str) -> Sessao:
    client = criar_cliente_usuario(config)
    try:
        resposta = client.auth.sign_in_with_password({"email": email.strip().lower(), "password": senha})
    except AuthError as exc:
        raise ErroNegocio("E-mail ou senha inválidos.") from exc
    if not resposta.session:
        raise ErroNegocio("E-mail ou senha inválidos.")
    return _montar_sessao(client, resposta.session)


def restaurar(config: Config, refresh_token: str) -> Sessao:
    """Retoma a sessão a partir do refresh token guardado no cookie do navegador."""
    client = criar_cliente_usuario(config)
    try:
        resposta = client.auth.refresh_session(refresh_token)
    except AuthError as exc:
        raise ErroNegocio("Sessão expirada. Entre novamente.") from exc
    if not resposta.session:
        raise ErroNegocio("Sessão expirada. Entre novamente.")
    return _montar_sessao(client, resposta.session)


def renovar_se_preciso(sessao: Sessao, agora: float | None = None) -> bool:
    """
    Renova o access token perto de expirar (1h). Retorna True se houve renovação — o refresh
    token também gira (rotação), então o chamador deve atualizar o cookie.
    Levanta ErroNegocio se a renovação falhar (sessão inválida => precisa entrar de novo).
    """
    agora = agora if agora is not None else time.time()
    if agora < sessao.expires_at - MARGEM_RENOVACAO_S:
        return False
    try:
        resposta = sessao.client.auth.refresh_session(sessao.refresh_token)
    except AuthError as exc:
        raise ErroNegocio("Sua sessão expirou. Entre novamente.") from exc
    if not resposta.session:
        raise ErroNegocio("Sua sessão expirou. Entre novamente.")
    sessao.refresh_token = resposta.session.refresh_token
    sessao.expires_at = int(resposta.session.expires_at or (agora + 3600))
    return True


def sair(sessao: Sessao) -> None:
    _sair_silencioso(sessao.client)
