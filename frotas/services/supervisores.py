from __future__ import annotations

import logging
from typing import Any

from supabase_auth.errors import AuthError

from frotas.infra.auth import Sessao
from frotas.infra.cliente import cliente_admin
from frotas.infra.erros import ErroNegocio
from frotas.services.base import executar
from frotas.services.validacao import validar_supervisor

log = logging.getLogger(__name__)


def listar_usuarios(sessao: Sessao) -> list[dict[str, Any]]:
    """Perfis (nome/role/filial) + e-mail (vive em auth.users => service role, só no servidor)."""
    sessao.exigir_admin()
    perfis = executar(sessao.client.table("profiles").select("id, nome, role, filial_id").order("nome")).data or []
    emails: dict[str, str] = {}
    try:
        for u in cliente_admin().auth.admin.list_users(page=1, per_page=1000):
            if u.email:
                emails[u.id] = u.email
    except (AuthError, RuntimeError):
        log.warning("Não foi possível listar e-mails dos usuários", exc_info=True)
    return [{**p, "email": emails.get(p["id"])} for p in perfis]


def criar_supervisor(sessao: Sessao, dados: dict[str, Any]) -> str:
    """Cria o usuário no Supabase Auth + o perfil de supervisor vinculado a UMA filial."""
    sessao.exigir_admin()
    v = validar_supervisor(dados)
    admin = cliente_admin()
    try:
        criado = admin.auth.admin.create_user(
            {"email": v["email"], "password": v["senha"], "email_confirm": True, "user_metadata": {"nome": v["nome"]}}
        )
    except AuthError as exc:
        duplicado = (
            getattr(exc, "status", None) == 422 or "already" in str(exc).lower() or "registered" in str(exc).lower()
        )
        raise ErroNegocio(
            "Já existe um usuário com este e-mail." if duplicado else "Não foi possível criar o usuário."
        ) from exc

    user_id = criado.user.id
    try:
        executar(
            admin.table("profiles").insert(
                {"id": user_id, "nome": v["nome"], "role": "supervisor", "filial_id": v["filial_id"]}
            )
        )
    except ErroNegocio:
        admin.auth.admin.delete_user(user_id)  # rollback
        raise
    return user_id


def excluir_supervisor(sessao: Sessao, usuario_id: str) -> None:
    sessao.exigir_admin()
    if usuario_id == sessao.user_id:
        raise ErroNegocio("Você não pode excluir o próprio usuário.")
    admin = cliente_admin()
    alvo = executar(admin.table("profiles").select("role").eq("id", usuario_id).limit(1)).data or []
    if not alvo or alvo[0]["role"] != "supervisor":
        raise ErroNegocio("Supervisor não encontrado.")
    try:
        admin.auth.admin.delete_user(usuario_id)
    except AuthError as exc:
        raise ErroNegocio(
            "Não foi possível excluir: o supervisor possui checklists registrados (histórico preservado)."
        ) from exc
