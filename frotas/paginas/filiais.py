from __future__ import annotations

import streamlit as st

from frotas.domain.formatos import filial_label
from frotas.infra.erros import ErroNegocio
from frotas.services import filiais as svc
from frotas.ui import componentes as ui
from frotas.ui import sessao as ui_sessao


def _form(sessao, filial: dict | None = None) -> None:
    chave = f"filial_form_{filial['id'] if filial else 'nova'}"
    with st.form(chave, border=not filial, clear_on_submit=filial is None):
        c1, c2 = st.columns([3, 1])
        cidade = c1.text_input("Cidade *", value=filial["nome_cidade"] if filial else "")
        uf = c2.text_input("UF *", value=filial["uf"] if filial else "", max_chars=2)
        enviar = st.form_submit_button("Salvar" if filial else "Adicionar filial", type="primary")
    if not enviar:
        return
    try:
        svc.salvar_filial(sessao, {"nome_cidade": cidade, "uf": uf}, filial["id"] if filial else None)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    st.toast("Filial salva.", icon="✅")
    st.rerun()


def pagina() -> None:
    sessao = ui_sessao.exigir_admin()
    st.title("Filiais")
    st.caption("Cidades/unidades da operação. Cada supervisor é vinculado a uma única filial.")

    with st.expander("Nova filial", icon=":material/add_business:"):
        _form(sessao)

    try:
        filiais = svc.listar_filiais(sessao.client)
        contagem = svc.contar_veiculos_por_filial(sessao.client)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    if not filiais:
        st.info("Nenhuma filial cadastrada. Adicione a primeira acima.")
    for f in filiais:
        with st.container(border=True):
            a, b = st.columns([3, 2], vertical_alignment="center")
            a.markdown(f"**{filial_label(f)}**")
            a.caption(f"{contagem.get(f['id'], 0)} veículo(s)")
            with b:
                ui.confirmar_exclusao(
                    f"fil_del_{f['id']}",
                    f"Excluir a filial {filial_label(f)}?",
                    lambda fid=f["id"]: svc.excluir_filial(sessao, fid),
                )
                if ui.foi_excluido(f"fil_del_{f['id']}"):
                    st.rerun()
            with st.expander("Editar"):
                _form(sessao, f)
