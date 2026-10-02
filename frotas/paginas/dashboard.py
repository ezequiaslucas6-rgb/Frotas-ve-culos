from __future__ import annotations

import streamlit as st

from frotas.domain.alertas import descrever_alerta
from frotas.domain.documentos import formatar_placa
from frotas.domain.formatos import brl, data_hora_br, filial_label, km
from frotas.infra.erros import ErroNegocio
from frotas.services import alertas as alertas_svc
from frotas.services import dashboard as dashboard_svc
from frotas.ui import componentes as ui
from frotas.ui import rotas
from frotas.ui import sessao as ui_sessao


def pagina() -> None:
    sessao = ui_sessao.exigir()
    st.title("Painel da frota")

    esq, dir_ = st.columns([3, 2], vertical_alignment="bottom")
    with esq:
        filial_id = ui.filtro_filial(sessao, "dash_filial")
        if not sessao.is_admin and sessao.perfil.filial:
            st.caption(f"Filial {filial_label(sessao.perfil.filial)}")
    with dir_:
        b1, b2 = st.columns(2)
        if b1.button("Atualizar alertas", icon=":material/refresh:", width="stretch"):
            try:
                r = alertas_svc.sincronizar_alertas(sessao.client, filial_id=filial_id)
                st.toast(
                    f"Alertas atualizados: {r.vencidos} vencido(s), {r.proximos} próximo(s) em {r.veiculos} veículo(s)."
                )
            except ErroNegocio as exc:
                st.toast(exc.mensagem, icon="⚠️")
        if b2.button("Novo checklist", icon=":material/add_a_photo:", type="primary", width="stretch"):
            rotas.abrir("checklist_novo")

    try:
        d = dashboard_svc.carregar_dashboard(sessao.client, filial_id, agrupar_por_filial=sessao.is_admin)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return

    cols = st.columns(5)
    cols[0].metric("Veículos", len(d.veiculos), border=True, icon=":material/local_shipping:")
    cols[1].metric("Liberados", d.contagem("liberado"), border=True, icon=":material/check_circle:")
    cols[2].metric("Atenção", d.contagem("atencao"), border=True, icon=":material/warning:")
    cols[3].metric("Manutenção/Avaria", d.contagem("manutencao"), border=True, icon=":material/build:")
    cols[4].metric("Custo no mês", brl(d.custo_mes), border=True, icon=":material/payments:")

    if d.por_filial:
        with st.container(border=True):
            st.subheader("Saúde da frota por filial")
            st.dataframe(
                [
                    {
                        "Filial": filial_label(r.filial),
                        "Veículos": r.total,
                        "🟢 Liberados": r.liberado,
                        "🟡 Atenção": r.atencao,
                        "🔴 Manutenção": r.manutencao,
                        "Custo no mês": brl(r.custo_mes),
                    }
                    for r in d.por_filial
                ],
                hide_index=True,
                width="stretch",
            )

    col1, col2 = st.columns(2)
    with col1, st.container(border=True):
        st.subheader("Requer atenção")
        if not d.requer_atencao:
            st.success("Toda a frota está liberada.", icon=":material/check_circle:")
        for v in d.requer_atencao:
            c1, c2 = st.columns([3, 2], vertical_alignment="center")
            with c1:
                st.markdown(f"**{formatar_placa(v.dados['placa'])}** · {v.dados.get('modelo') or ''}")
                prefixo = (
                    f"{filial_label({'nome_cidade': v.dados['nome_cidade'], 'uf': v.dados['uf']})} · "
                    if sessao.is_admin
                    else ""
                )
                st.caption(prefixo + " · ".join(v.avaliacao.motivos))
            with c2:
                ui.badge_saude(v.avaliacao.saude)
                if st.button("Abrir", key=f"dash_at_{v.id}", width="stretch"):
                    rotas.abrir("veiculos", "detalhe", v.id)

    with col2, st.container(border=True):
        st.subheader("Alertas de revisão preventiva")
        if not d.alertas_revisao:
            st.success("Nenhuma revisão próxima ou vencida.", icon=":material/check_circle:")
        for v in d.alertas_revisao:
            c1, c2 = st.columns([3, 2], vertical_alignment="center")
            with c1:
                st.markdown(f"**{formatar_placa(v.dados['placa'])}**")
                st.caption(f"{descrever_alerta(v.avaliacao.alerta)} · {km(v.dados['km_atual'])}")
            with c2:
                ui.badge_alerta(v.avaliacao.alerta.nivel)
                if st.button("Registrar", key=f"dash_al_{v.id}", width="stretch"):
                    rotas.abrir("manutencoes", "nova", None, manutencao_veiculo_inicial=v.id)

    with st.container(border=True):
        c1, c2 = st.columns([3, 1], vertical_alignment="center")
        c1.subheader("Últimos checklists")
        if c2.button("Ver todos", width="stretch"):
            rotas.abrir("checklists")
        if not d.ultimos_checklists:
            st.info("Nenhum checklist enviado ainda.")
        for c in d.ultimos_checklists:
            a, b = st.columns([4, 1], vertical_alignment="center")
            placa = formatar_placa(c["veiculo"]["placa"]) if c.get("veiculo") else "—"
            a.markdown(f"**{placa}**")
            nome = c["motorista"]["nome"] if c.get("motorista") else "—"
            a.caption(f"{nome} · {data_hora_br(c['data_envio'])}")
            with b:
                ui.badge_checklist(c["status"])
                if st.button("Abrir", key=f"dash_ck_{c['id']}", width="stretch"):
                    rotas.abrir("checklists", "detalhe", c["id"])
