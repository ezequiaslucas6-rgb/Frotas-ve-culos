from __future__ import annotations

import streamlit as st

from frotas.domain.documentos import formatar_cpf, formatar_whatsapp, link_whatsapp
from frotas.domain.formatos import filial_label
from frotas.infra.erros import ErroNegocio
from frotas.services import filiais as filiais_svc
from frotas.services import motoristas as motoristas_svc
from frotas.ui import componentes as ui
from frotas.ui import rotas
from frotas.ui import sessao as ui_sessao

CHAVE = "motoristas"
STATUS = {"ativo": "Ativo", "ferias": "Férias", "afastado": "Afastado", "inativo": "Inativo"}


def pagina() -> None:
    sessao = ui_sessao.exigir()
    modo, id_ = rotas.modo(CHAVE)
    if modo in ("novo", "editar"):
        _formulario(sessao, id_ if modo == "editar" else None)
    else:
        _lista(sessao)


def _lista(sessao) -> None:
    st.title("Motoristas")
    c1, c2, c3 = st.columns([3, 2, 1], vertical_alignment="bottom")
    busca = c1.text_input("Buscar", placeholder="Nome, e-mail ou CPF", key="mot_busca", label_visibility="collapsed")
    with c2:
        filial_id = ui.filtro_filial(sessao, "mot_filial")
    if c3.button("Novo motorista", icon=":material/person_add:", type="primary", width="stretch"):
        rotas.ir(CHAVE, "novo")

    pagina_n = ui.pagina_atual("mot_pagina", (busca, filial_id))
    try:
        itens, total = motoristas_svc.listar_motoristas(sessao.client, filial_id, busca, pagina_n)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return

    st.caption(f"{total} motorista(s)")
    if not itens:
        st.info(
            "Nenhum motorista encontrado."
            if busca
            else "Cadastre os motoristas da filial para vinculá-los aos checklists."
        )
    for m in itens:
        with st.container(border=True):
            nome, status = st.columns([4, 1], vertical_alignment="top")
            with nome:
                st.markdown(f"**{m['nome']}**")
                local = f" · {filial_label(m['filial'])}" if sessao.is_admin and m.get("filial") else ""
                st.caption(f"CPF {formatar_cpf(m['cpf'])} · CNH {m['cnh']}{local}")
                st.caption(m["email"])
            with status:
                ui.badge_motorista(m["status"])
            b1, b2, b3 = st.columns([3, 2, 2], vertical_alignment="center")
            with b1:
                # Contato rápido: abre a conversa no WhatsApp (app nativo no celular, Web no desktop)
                st.link_button(
                    formatar_whatsapp(m["whatsapp"]),
                    link_whatsapp(m["whatsapp"], f"Olá {m['nome'].split()[0]}, tudo bem?"),
                    icon=":material/chat:",
                    width="stretch",
                    help=f"Chamar {m['nome']} no WhatsApp",
                )
            if b2.button("Editar", icon=":material/edit:", key=f"mot_ed_{m['id']}", width="stretch"):
                rotas.ir(CHAVE, "editar", m["id"])
            if sessao.is_admin:
                with b3:
                    ui.confirmar_exclusao(
                        f"mot_del_{m['id']}",
                        f"Excluir o motorista {m['nome']}? Esta ação não pode ser desfeita.",
                        lambda mid=m["id"]: motoristas_svc.excluir_motorista(sessao, mid),
                    )
                if ui.foi_excluido(f"mot_del_{m['id']}"):
                    st.rerun()
    ui.paginacao("mot_pagina", total)


def _formulario(sessao, motorista_id: str | None) -> None:
    edicao = motorista_id is not None
    atual = motoristas_svc.obter_motorista(sessao.client, motorista_id) if motorista_id else None
    if edicao and not atual:
        st.warning("Motorista não encontrado.")
        if st.button("Voltar"):
            rotas.ir(CHAVE)
        return
    atual = atual or {}
    st.title(f"Editar {atual['nome']}" if edicao else "Novo motorista")

    with st.form(f"mot_form_{motorista_id or 'novo'}", border=True):
        filial_id = None
        if sessao.is_admin and not edicao:
            filiais = filiais_svc.listar_filiais(sessao.client)
            rotulos = {f["id"]: filial_label(f) for f in filiais}
            filial_id = st.selectbox(
                "Filial *", list(rotulos), format_func=rotulos.get, index=None, placeholder="Selecione a filial…"
            )
        nome = st.text_input("Nome completo *", value=atual.get("nome", ""))
        c1, c2 = st.columns(2)
        cpf = c1.text_input("CPF *", value=formatar_cpf(atual.get("cpf")), placeholder="000.000.000-00")
        cnh = c2.text_input("CNH *", value=atual.get("cnh", ""), placeholder="11 dígitos", max_chars=11)
        email = c1.text_input("E-mail *", value=atual.get("email", ""))
        whatsapp = c2.text_input(
            "WhatsApp *", value=formatar_whatsapp(atual.get("whatsapp")), placeholder="(11) 99999-9999"
        )
        status = st.selectbox(
            "Status", list(STATUS), format_func=STATUS.get, index=list(STATUS).index(atual.get("status", "ativo"))
        )
        enviar = st.form_submit_button(
            "Salvar alterações" if edicao else "Cadastrar motorista", type="primary", width="stretch"
        )
    if st.button("Cancelar", width="stretch"):
        rotas.ir(CHAVE)
    if not enviar:
        return
    try:
        motoristas_svc.salvar_motorista(
            sessao,
            {
                "nome": nome,
                "cpf": cpf,
                "cnh": cnh,
                "email": email,
                "whatsapp": whatsapp,
                "status": status,
                "filial_id": filial_id,
            },
            motorista_id,
        )
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    st.toast("Motorista salvo.", icon="✅")
    rotas.ir(CHAVE)
