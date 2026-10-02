"""
Navegação interna.

Cada página tem um "modo" (lista | detalhe | novo | editar ...) guardado em st.session_state, o que evita
rotas aninhadas e mantém o estado ao voltar para a lista.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

_PAGINAS: dict[str, Any] = {}


def registrar(paginas: dict[str, Any]) -> None:
    """Chamado pelo entrypoint com {nome: st.Page}."""
    _PAGINAS.clear()
    _PAGINAS.update(paginas)


def modo(pagina: str, padrao: str = "lista") -> tuple[str, str | None]:
    return st.session_state.get(f"{pagina}:modo", padrao), st.session_state.get(f"{pagina}:id")


def ir(pagina: str, novo_modo: str = "lista", id: str | None = None) -> None:
    """Muda o modo da página atual e redesenha."""
    st.session_state[f"{pagina}:modo"] = novo_modo
    st.session_state[f"{pagina}:id"] = id
    st.rerun()


def abrir(pagina: str, novo_modo: str = "lista", id: str | None = None, **estado: Any) -> None:
    """Vai para OUTRA página já no modo desejado (e com estado extra, ex.: veículo pré-selecionado)."""
    st.session_state[f"{pagina}:modo"] = novo_modo
    st.session_state[f"{pagina}:id"] = id
    st.session_state.update(estado)
    if pagina not in _PAGINAS:
        st.rerun()
    st.switch_page(_PAGINAS[pagina])
