from __future__ import annotations

import streamlit as st

from frotas.domain.formatos import filial_label
from frotas.infra.erros import ErroNegocio
from frotas.services import filiais as filiais_svc
from frotas.services import supervisores as svc
from frotas.ui import componentes as ui
from frotas.ui import sessao as ui_sessao


def pagina() -> None:
    sessao = ui_sessao.exigir_admin()
    st.title("Supervisores")
    st.caption("Usuários com acesso restrito à filial a que estão vinculados.")

    try:
        filiais = filiais_svc.listar_filiais(sessao.client)
        usuarios = svc.listar_usuarios(sessao)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    rotulos = {f["id"]: filial_label(f) for f in filiais}

    with st.expander("Novo supervisor", icon=":material/person_add:", expanded=not usuarios):
        if not filiais:
            st.info("Cadastre uma filial antes de criar supervisores.")
        else:
            with st.form("sup_form", clear_on_submit=True, border=False):
                nome = st.text_input("Nome *")
                email = st.text_input("E-mail *")
                senha = st.text_input("Senha provisória *", type="password", help="Mínimo de 8 caracteres.")
                filial_id = st.selectbox(
                    "Filial *", list(rotulos), format_func=rotulos.get, index=None, placeholder="Selecione a filial…"
                )
                enviar = st.form_submit_button("Criar supervisor", type="primary")
            if enviar:
                try:
                    svc.criar_supervisor(sessao, {"nome": nome, "email": email, "senha": senha, "filial_id": filial_id})
                except ErroNegocio as exc:
                    ui.mostrar_erro(exc)
                else:
                    st.toast(f"Supervisor {nome} criado. Repasse o e-mail e a senha provisória a ele.", icon="✅")
                    st.rerun()

    for u in usuarios:
        with st.container(border=True):
            a, b, c = st.columns([3, 2, 1], vertical_alignment="center")
            a.markdown(f"**{u['nome']}**")
            a.caption(u.get("email") or "—")
            with b:
                st.badge("Administrador Geral", color="primary") if u["role"] == "admin" else st.badge(
                    rotulos.get(u["filial_id"], "Sem filial"), color="gray"
                )
            if u["role"] == "supervisor" and u["id"] != sessao.user_id:
                with c:
                    ui.confirmar_exclusao(
                        f"sup_del_{u['id']}",
                        f"Excluir o supervisor {u['nome']}? Ele perderá o acesso imediatamente.",
                        lambda uid=u["id"]: svc.excluir_supervisor(sessao, uid),
                    )
                    if ui.foi_excluido(f"sup_del_{u['id']}"):
                        st.rerun()
