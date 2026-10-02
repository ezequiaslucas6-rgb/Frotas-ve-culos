from __future__ import annotations

import streamlit as st

from frotas.infra.erros import ErroNegocio
from frotas.ui import sessao as ui_sessao


def pagina_login() -> None:
    _, centro, _ = st.columns([1, 2, 1])
    with centro:
        st.markdown("## 🚚 Gestão de Frotas")
        st.caption("Entre com seu e-mail e senha")
        with st.form("login", border=True):
            email = st.text_input("E-mail", autocomplete="email", key="login_email")
            senha = st.text_input("Senha", type="password", autocomplete="current-password", key="login_senha")
            enviar = st.form_submit_button("Entrar", type="primary", width="stretch")
        if enviar:
            if not email.strip() or not senha:
                st.error("Informe e-mail e senha.")
                return
            try:
                with st.spinner("Entrando…"):
                    ui_sessao.entrar(email, senha)
            except ErroNegocio as exc:
                st.error(exc.mensagem)
                return
            st.rerun()
