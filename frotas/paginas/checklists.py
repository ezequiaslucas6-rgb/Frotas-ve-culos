"""Lista e detalhe dos checklists enviados."""

from __future__ import annotations

import io
import json

import httpx
import streamlit as st

from frotas.domain.checklist import SEVERIDADE_LABEL
from frotas.domain.documentos import formatar_placa, link_whatsapp
from frotas.domain.formatos import data_hora_br, filial_label, km
from frotas.domain.imagens import desenhar_marcadores
from frotas.infra.erros import ErroNegocio
from frotas.services import checklists as svc
from frotas.ui import componentes as ui
from frotas.ui import rotas
from frotas.ui import sessao as ui_sessao

CHAVE = "checklists"


def pagina() -> None:
    sessao = ui_sessao.exigir()
    modo, id_ = rotas.modo(CHAVE)
    _detalhe(sessao, id_) if modo == "detalhe" and id_ else _lista(sessao)


def _lista(sessao) -> None:
    st.title("Checklists")
    c1, c2, c3 = st.columns([2, 2, 2], vertical_alignment="bottom")
    with c1:
        filial_id = ui.filtro_filial(sessao, "ck_filial")
    status = c2.selectbox(
        "Status",
        [None, "ok", "atencao", "critico"],
        format_func=lambda s: "Todos os status" if s is None else SEVERIDADE_LABEL[s],
        key="ck_status",
    )
    if c3.button("Novo checklist", icon=":material/add_a_photo:", type="primary", width="stretch"):
        rotas.abrir("checklist_novo")

    pagina_n = ui.pagina_atual("ck_pagina", (filial_id, status))
    try:
        itens, total = svc.listar_checklists(sessao.client, filial_id, status, pagina_n)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return

    st.caption(f"{total} checklist(s) enviado(s)")
    if not itens:
        st.info("Nenhum checklist encontrado. Inicie um checklist para registrar as 14 fotos obrigatórias do veículo.")
    for c in itens:
        with st.container(border=True):
            a, b = st.columns([4, 1], vertical_alignment="center")
            v = c.get("veiculo")
            a.markdown(
                f"**{formatar_placa(v['placa']) if v else '—'}**"
                + (f" · {v['modelo']}" if v and v.get("modelo") else "")
            )
            nome = c["motorista"]["nome"] if c.get("motorista") else "—"
            extra = (f" · {km(c['km_registro'])}" if c.get("km_registro") is not None else "") + (
                f" · {filial_label(c['filial'])}" if sessao.is_admin and c.get("filial") else ""
            )
            a.caption(f"{nome} · {data_hora_br(c['data_envio'])}{extra}")
            with b:
                ui.badge_checklist(c["status"])
                if st.button("Abrir", key=f"ck_{c['id']}", width="stretch"):
                    rotas.ir(CHAVE, "detalhe", c["id"])
    ui.paginacao("ck_pagina", total)


@st.cache_data(ttl=600, show_spinner=False, max_entries=64)
def _foto_com_marcadores(url: str, marcadores_json: str) -> bytes:
    """Baixa a foto (URL assinada) e sobrepõe os pins de avaria."""
    resposta = httpx.get(url, timeout=30)
    resposta.raise_for_status()
    bruto = resposta.content
    saida = io.BytesIO()
    desenhar_marcadores(bruto, json.loads(marcadores_json)).save(saida, format="JPEG", quality=85)
    return saida.getvalue()


def _detalhe(sessao, checklist_id: str) -> None:
    if st.button("Voltar", icon=":material/arrow_back:"):
        rotas.ir(CHAVE)
    try:
        c = svc.obter_checklist(sessao.client, checklist_id)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    if not c:
        st.warning("Checklist não encontrado.")
        return

    v = c.get("veiculo")
    st.title(f"Checklist · {formatar_placa(v['placa']) if v else ''}")
    st.caption(data_hora_br(c["data_envio"]))
    topo = st.columns([1, 1, 1, 1])
    with topo[0]:
        ui.badge_checklist(c["status"])
    if v and topo[1].button("Ver veículo", icon=":material/local_shipping:", width="stretch"):
        rotas.abrir("veiculos", "detalhe", v["id"])
    if sessao.is_admin:
        with topo[2]:
            ui.confirmar_exclusao(
                "ck_excluir",
                "Excluir este checklist e todas as suas fotos?",
                lambda: svc.excluir_checklist(sessao, checklist_id),
            )
        if ui.foi_excluido("ck_excluir"):
            rotas.ir(CHAVE)

    fotos = [f for _, f in c["fotos"] if f]
    com_problema = sum(f["severidade"] != "ok" for f in fotos)
    with st.container(border=True):
        a, b, d, e = st.columns(4)
        a.caption("Motorista")
        mot = c.get("motorista")
        a.markdown(f"**{mot['nome'] if mot else '—'}**")
        if mot and mot.get("whatsapp"):
            a.link_button("WhatsApp", link_whatsapp(mot["whatsapp"]), icon=":material/chat:")
        b.caption("Registrado por")
        b.markdown(f"**{c.get('supervisor_nome') or '—'}**")
        if c.get("filial"):
            b.caption(filial_label(c["filial"]))
        d.caption("KM")
        d.markdown(f"**{km(c['km_registro']) if c.get('km_registro') is not None else '—'}**")
        e.caption("Itens com inconformidade")
        e.markdown(f"**{com_problema} de {len(fotos)}**")
        if c.get("observacoes_gerais"):
            st.caption("Observações gerais")
            st.write(c["observacoes_gerais"])

    colunas = st.columns(2)
    for i, (etapa, foto) in enumerate(c["fotos"], start=1):
        with colunas[(i - 1) % 2], st.container(border=True):
            t, s = st.columns([3, 2], vertical_alignment="center")
            t.markdown(f"**{i}. {etapa.titulo}**")
            if foto:
                with s:
                    ui.badge_checklist(foto["severidade"])
                if foto.get("url"):
                    marcadores = foto.get("marcadores") or []
                    try:
                        st.image(
                            _foto_com_marcadores(foto["url"], json.dumps(marcadores)) if marcadores else foto["url"],
                            width="stretch",
                        )
                    except (httpx.HTTPError, ValueError):
                        st.image(foto["url"], width="stretch")
                else:
                    st.caption("Foto indisponível.")
                if foto.get("observacao"):
                    st.info(foto["observacao"])
            else:
                st.caption("Foto indisponível.")
