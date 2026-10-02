from __future__ import annotations

import streamlit as st

from frotas.domain.alertas import descrever_alerta
from frotas.domain.dates import parse_data
from frotas.domain.documentos import formatar_placa
from frotas.domain.formatos import brl, data_br, data_hora_br, filial_label, km
from frotas.infra import storage
from frotas.infra.erros import ErroNegocio
from frotas.services import checklists as checklists_svc
from frotas.services import filiais as filiais_svc
from frotas.services import manutencoes as manutencoes_svc
from frotas.services import painel
from frotas.services import veiculos as veiculos_svc
from frotas.ui import componentes as ui
from frotas.ui import rotas
from frotas.ui import sessao as ui_sessao

CHAVE = "veiculos"


def pagina() -> None:
    sessao = ui_sessao.exigir()
    modo, id_ = rotas.modo(CHAVE)
    if modo == "detalhe" and id_:
        _detalhe(sessao, id_)
    elif modo in ("novo", "editar"):
        _formulario(sessao, id_ if modo == "editar" else None)
    else:
        _lista(sessao)


def _titulo_modelo(d: dict) -> str:
    return " ".join(str(x) for x in (d.get("marca"), d.get("modelo"), d.get("ano")) if x) or "Sem modelo informado"


def _lista(sessao) -> None:
    st.title("Veículos")
    c1, c2, c3 = st.columns([3, 2, 1], vertical_alignment="bottom")
    busca = c1.text_input(
        "Buscar", placeholder="Placa, marca ou modelo", key="veic_busca", label_visibility="collapsed"
    )
    with c2:
        filial_id = ui.filtro_filial(sessao, "veic_filial")
    if c3.button("Novo veículo", icon=":material/add:", type="primary", width="stretch"):
        rotas.ir(CHAVE, "novo")

    pagina_n = ui.pagina_atual("veic_pagina", (busca, filial_id))
    try:
        itens, total = painel.listar_veiculos(sessao.client, filial_id, busca, pagina_n)
        fotos = storage.urls_assinadas(
            sessao.client, storage.BUCKET_VEICULOS, [v.dados["foto_geral_url"] for v in itens]
        )
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return

    st.caption(f"{total} veículo(s)")
    if not itens:
        st.info(
            "Nenhum veículo encontrado."
            if busca
            else "Cadastre o primeiro veículo para começar a registrar checklists."
        )
    for v in itens:
        d = v.dados
        with st.container(border=True):
            foto, info, acao = st.columns([1, 4, 2], vertical_alignment="center")
            with foto:
                url = fotos.get(d["foto_geral_url"] or "")
                st.image(url, width="stretch") if url else st.markdown(
                    "<div style='font-size:2.2rem;text-align:center'>🚚</div>", unsafe_allow_html=True
                )
            with info:
                st.markdown(f"**{formatar_placa(d['placa'])}** · {_titulo_modelo(d)}")
                local = (
                    f" · {filial_label({'nome_cidade': d['nome_cidade'], 'uf': d['uf']})}" if sessao.is_admin else ""
                )
                st.caption(f"{km(d['km_atual'])}{local}")
                if v.avaliacao.alerta.nivel != "ok":
                    st.caption(descrever_alerta(v.avaliacao.alerta))
            with acao:
                ui.badge_saude(v.avaliacao.saude)
                if st.button("Abrir", key=f"veic_{v.id}", width="stretch"):
                    rotas.ir(CHAVE, "detalhe", v.id)
    ui.paginacao("veic_pagina", total)


def _detalhe(sessao, veiculo_id: str) -> None:
    if st.button("Voltar", icon=":material/arrow_back:"):
        rotas.ir(CHAVE)
    v = painel.obter_veiculo(sessao.client, veiculo_id)
    if not v:
        st.warning("Veículo não encontrado.")
        return
    d = v.dados
    st.title(formatar_placa(d["placa"]))
    st.caption(f"{_titulo_modelo(d)} · {filial_label({'nome_cidade': d['nome_cidade'], 'uf': d['uf']})}")

    a, b, c, e = st.columns(4)
    if a.button("Novo checklist", icon=":material/add_a_photo:", type="primary", width="stretch"):
        rotas.abrir("checklist_novo", checklist_veiculo_inicial=v.id)
    if b.button("Registrar manutenção", icon=":material/build:", width="stretch"):
        rotas.abrir("manutencoes", "nova", None, manutencao_veiculo_inicial=v.id)
    if c.button("Editar", icon=":material/edit:", width="stretch"):
        rotas.ir(CHAVE, "editar", v.id)
    if sessao.is_admin:
        with e:
            ui.confirmar_exclusao(
                "veic_excluir",
                f"Excluir o veículo {formatar_placa(d['placa'])}? Esta ação não pode ser desfeita.",
                lambda: veiculos_svc.excluir_veiculo(sessao, v.id),
            )
        if ui.foi_excluido("veic_excluir"):
            rotas.ir(CHAVE)

    urls = storage.urls_assinadas(sessao.client, storage.BUCKET_VEICULOS, [d["foto_geral_url"], d["documento_url"]])
    col_foto, col_info = st.columns([2, 3])
    with col_foto, st.container(border=True):
        foto = urls.get(d["foto_geral_url"] or "")
        if foto:
            st.image(foto, width="stretch")
        else:
            st.markdown("<div style='font-size:4rem;text-align:center'>🚚</div>", unsafe_allow_html=True)
        doc = urls.get(d["documento_url"] or "")
        if doc:
            st.link_button("Documento do veículo", doc, icon=":material/description:", width="stretch")
    with col_info, st.container(border=True):
        st.subheader("Situação")
        s1, s2 = st.columns(2)
        with s1:
            ui.badge_saude(v.avaliacao.saude)
        with s2:
            ui.badge_alerta(v.avaliacao.alerta.nivel)
        for motivo in v.avaliacao.motivos:
            st.markdown(f"- {motivo}")
        m1, m2 = st.columns(2)
        m1.metric("KM atual", km(d["km_atual"]))
        prox = km(d["proxima_revisao_km"]) if d["proxima_revisao_km"] is not None else "—"
        m2.metric("Próxima revisão", prox, data_br(d["proxima_revisao_data"]), delta_color="off")
        plano = descrever_alerta(v.avaliacao.alerta, apenas_disparados=False)
        st.caption(f"{plano} · revisão a cada {km(d['intervalo_revisao_km'])} ou {d['intervalo_revisao_dias']} dias")

    col1, col2 = st.columns(2)
    with col1, st.container(border=True):
        st.subheader("Checklists recentes")
        cks, _ = checklists_svc.listar_checklists(sessao.client, filial_id=d["filial_id"])
        cks = [c for c in cks if c["veiculo_id"] == v.id][:8]
        if not cks:
            st.caption("Nenhum checklist registrado.")
        for ck in cks:
            x, y = st.columns([3, 1], vertical_alignment="center")
            nome = ck["motorista"]["nome"] if ck.get("motorista") else "—"
            x.markdown(f"**{data_hora_br(ck['data_envio'])}**")
            x.caption(f"{nome}" + (f" · {km(ck['km_registro'])}" if ck.get("km_registro") is not None else ""))
            with y:
                ui.badge_checklist(ck["status"])
                if st.button("Abrir", key=f"vck_{ck['id']}", width="stretch"):
                    rotas.abrir("checklists", "detalhe", ck["id"])
    with col2, st.container(border=True):
        st.subheader("Manutenções")
        ms, _ = manutencoes_svc.listar_manutencoes(
            sessao.client, manutencoes_svc.FiltroManutencao(filial_id=d["filial_id"])
        )
        ms = [m for m in ms if m["veiculo_id"] == v.id][:8]
        if not ms:
            st.caption("Nenhuma manutenção registrada.")
        for m in ms:
            x, y = st.columns([3, 1], vertical_alignment="center")
            x.markdown(m["descricao"][:90])
            x.caption(f"{data_br(m['data_manutencao'])} · {km(m['km_registro'])}")
            y.caption("Preventiva" if m["tipo"] == "preventiva" else "Corretiva")
            y.markdown(f"**{brl(m['custo'])}**")


def _formulario(sessao, veiculo_id: str | None) -> None:
    edicao = veiculo_id is not None
    atual = veiculos_svc.obter_veiculo_tabela(sessao.client, veiculo_id) if veiculo_id else None
    if edicao and not atual:
        st.warning("Veículo não encontrado.")
        if st.button("Voltar"):
            rotas.ir(CHAVE)
        return

    st.title(f"Editar {formatar_placa(atual['placa'])}" if atual else "Novo veículo")
    urls = (
        storage.urls_assinadas(
            sessao.client, storage.BUCKET_VEICULOS, [atual["foto_geral_url"], atual["documento_url"]]
        )
        if atual
        else {}
    )
    atual = atual or {}

    with st.form(f"veiculo_form_{veiculo_id or 'novo'}", border=False):
        filial_id = None
        if sessao.is_admin and not edicao:
            filiais = filiais_svc.listar_filiais(sessao.client)
            rotulos = {f["id"]: filial_label(f) for f in filiais}
            filial_id = st.selectbox(
                "Filial *", list(rotulos), format_func=rotulos.get, index=None, placeholder="Selecione a filial…"
            )

        st.subheader("Identificação")
        c1, c2 = st.columns(2)
        placa = c1.text_input("Placa *", value=atual.get("placa", ""), max_chars=8, placeholder="ABC1D23")
        ano = c2.number_input("Ano", min_value=1950, max_value=2100, value=atual.get("ano"), step=1, placeholder="2024")
        marca = c1.text_input("Marca", value=atual.get("marca") or "", placeholder="Fiat")
        modelo = c2.text_input("Modelo", value=atual.get("modelo") or "", placeholder="Strada")

        st.subheader("Fotos e documento")
        foto = st.file_uploader(
            "Foto geral do veículo",
            type=["jpg", "jpeg", "png", "webp"],
            help="No celular, você pode tirar a foto na hora.",
        )
        if urls.get(atual.get("foto_geral_url") or ""):
            st.image(urls[atual["foto_geral_url"]], width=160, caption="Foto atual")
        remover_foto = st.checkbox("Remover foto atual") if atual.get("foto_geral_url") else False
        doc = st.file_uploader(
            "Documento do veículo (CRLV)",
            type=["pdf", "jpg", "jpeg", "png", "webp"],
            help="PDF ou imagem digitalizada (até 10 MB).",
        )
        if urls.get(atual.get("documento_url") or ""):
            st.link_button("Ver documento atual", urls[atual["documento_url"]], icon=":material/description:")
        remover_doc = st.checkbox("Remover documento atual") if atual.get("documento_url") else False

        st.subheader("Quilometragem e plano de revisão")
        km_atual = st.number_input("KM atual *", min_value=0, value=int(atual.get("km_atual", 0)), step=100)
        i1, i2 = st.columns(2)
        int_km = i1.number_input(
            "Revisão a cada (KM) *", min_value=1, value=int(atual.get("intervalo_revisao_km", 10000)), step=500
        )
        int_dias = i2.number_input(
            "Revisão a cada (dias) *", min_value=1, value=int(atual.get("intervalo_revisao_dias", 180)), step=15
        )
        p1, p2 = st.columns(2)
        prox_km = p1.number_input(
            "Próxima revisão (KM)",
            min_value=0,
            value=atual.get("proxima_revisao_km"),
            step=500,
            help=None if edicao else "Em branco: KM atual + intervalo.",
        )
        prox_data = p2.date_input(
            "Próxima revisão (data)",
            value=parse_data(atual["proxima_revisao_data"]) if atual.get("proxima_revisao_data") else None,
            format="DD/MM/YYYY",
            help=None if edicao else "Em branco: hoje + intervalo.",
        )

        enviar = st.form_submit_button(
            "Salvar alterações" if edicao else "Cadastrar veículo", type="primary", width="stretch"
        )

    if st.button("Cancelar", width="stretch"):
        rotas.ir(CHAVE, "detalhe" if veiculo_id else "lista", veiculo_id)
    if not enviar:
        return

    dados = {
        "placa": placa, "marca": marca, "modelo": modelo, "ano": ano, "km_atual": km_atual,
        "intervalo_revisao_km": int_km, "intervalo_revisao_dias": int_dias,
        "proxima_revisao_km": prox_km, "proxima_revisao_data": prox_data, "filial_id": filial_id,
    }  # fmt: skip
    try:
        with st.spinner("Salvando…"):
            novo_id = veiculos_svc.salvar_veiculo(
                sessao,
                dados,
                veiculo_id,
                foto=veiculos_svc.Arquivo(foto.getvalue(), foto.type) if foto else None,
                documento=veiculos_svc.Arquivo(doc.getvalue(), doc.type) if doc else None,
                remover_foto=remover_foto,
                remover_documento=remover_doc,
            )
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    st.toast("Veículo salvo.", icon="✅")
    rotas.ir(CHAVE, "detalhe", novo_id)
