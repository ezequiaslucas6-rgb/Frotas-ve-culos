"""Componentes visuais reutilizáveis."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import streamlit as st

from frotas.domain.alertas import NivelAlerta, SaudeVeiculo
from frotas.domain.formatos import filial_label
from frotas.infra.auth import Sessao
from frotas.infra.erros import ErroNegocio, ErroValidacao
from frotas.services import filiais as filiais_svc

_SAUDE = {
    "liberado": ("Liberado", ":material/check_circle:", "green"),
    "atencao": ("Atenção", ":material/warning:", "orange"),
    "manutencao": ("Manutenção/Avaria", ":material/build:", "red"),
}
_CHECKLIST = {"ok": ("Conforme", "green"), "atencao": ("Atenção", "orange"), "critico": ("Avaria", "red")}
_ALERTA = {
    "vencido": ("Revisão vencida", ":material/error:", "red"),
    "proximo": ("Revisão próxima", ":material/schedule:", "orange"),
    "ok": ("Em dia", ":material/check:", "green"),
}
_MOTORISTA = {
    "ativo": ("Ativo", "green"),
    "inativo": ("Inativo", "gray"),
    "afastado": ("Afastado", "orange"),
    "ferias": ("Férias", "blue"),
}


def badge_saude(saude: SaudeVeiculo) -> None:
    """Semáforo da frota: verde = Liberado, amarelo = Atenção, vermelho = Manutenção/Avaria."""
    rotulo, icone, cor = _SAUDE[saude]
    st.badge(rotulo, icon=icone, color=cor)


def badge_checklist(status: str) -> None:
    rotulo, cor = _CHECKLIST[status]
    st.badge(rotulo, color=cor)


def badge_alerta(nivel: NivelAlerta) -> None:
    rotulo, icone, cor = _ALERTA[nivel]
    st.badge(rotulo, icon=icone, color=cor)


def badge_motorista(status: str) -> None:
    rotulo, cor = _MOTORISTA[status]
    st.badge(rotulo, color=cor)


def mostrar_erro(exc: ErroNegocio) -> None:
    """Erros de negócio/validação: lista os campos inválidos quando houver."""
    if isinstance(exc, ErroValidacao) and exc.campos:
        linhas = "\n".join(f"- **{campo.replace('_', ' ').capitalize()}**: {msg}" for campo, msg in exc.campos.items())
        st.error(f"{exc.mensagem}\n\n{linhas}")
    else:
        st.error(exc.mensagem)


def filtro_filial(sessao: Sessao, chave: str) -> str | None:
    """Admin: seletor de filial (ou todas). Supervisor: fixo na própria filial."""
    if not sessao.is_admin:
        return sessao.filial_id
    filiais = filiais_svc.listar_filiais(sessao.client)
    opcoes: list[str | None] = [None, *[f["id"] for f in filiais]]
    rotulos = {f["id"]: filial_label(f) for f in filiais}
    return st.selectbox(
        "Filial", opcoes, format_func=lambda i: "Todas as filiais" if i is None else rotulos[i], key=chave
    )


def pagina_atual(chave: str, assinatura: Any = None) -> int:
    """Página corrente; volta para a 1ª quando os filtros (assinatura) mudam."""
    if st.session_state.get(f"{chave}:sig") != assinatura:
        st.session_state[f"{chave}:sig"] = assinatura
        st.session_state[chave] = 1
    return int(st.session_state.get(chave, 1))


def paginacao(chave: str, total: int, tamanho: int = 20) -> None:
    paginas = max(1, math.ceil(total / tamanho))
    atual = min(int(st.session_state.get(chave, 1)), paginas)
    if paginas <= 1:
        return
    esq, meio, dir_ = st.columns([1, 2, 1], vertical_alignment="center")
    if esq.button("Anterior", icon=":material/chevron_left:", disabled=atual <= 1, key=f"{chave}:ant", width="stretch"):
        st.session_state[chave] = atual - 1
        st.rerun()
    meio.caption(f"Página {atual} de {paginas} · {total} registros")
    if dir_.button(
        "Próxima",
        icon=":material/chevron_right:",
        icon_position="right",
        disabled=atual >= paginas,
        key=f"{chave}:prox",
        width="stretch",
    ):
        st.session_state[chave] = atual + 1
        st.rerun()


def confirmar_exclusao(chave: str, mensagem: str, executar: Callable[[], None], rotulo: str = "Excluir") -> None:
    """Botão de exclusão com confirmação (diálogo). `executar` levanta ErroNegocio em caso de falha."""

    @st.dialog(rotulo)
    def _dialogo() -> None:
        st.write(mensagem)
        c1, c2 = st.columns(2)
        if c1.button("Cancelar", key=f"{chave}:nao", width="stretch"):
            st.rerun()
        if c2.button("Confirmar exclusão", type="primary", key=f"{chave}:sim", width="stretch"):
            try:
                executar()
            except ErroNegocio as exc:
                st.error(exc.mensagem)
                return
            st.session_state[f"{chave}:excluido"] = True
            st.rerun()

    if st.button(rotulo, icon=":material/delete:", key=chave):
        _dialogo()


def foi_excluido(chave: str) -> bool:
    """True (uma única vez) após uma exclusão confirmada em `confirmar_exclusao`."""
    return bool(st.session_state.pop(f"{chave}:excluido", False))
