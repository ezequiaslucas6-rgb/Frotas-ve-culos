from __future__ import annotations

import streamlit as st

from frotas.domain.dates import hoje
from frotas.domain.documentos import formatar_placa
from frotas.domain.formatos import brl, data_br, filial_label, km, veiculo_label
from frotas.infra.erros import ErroNegocio
from frotas.services import manutencoes as svc
from frotas.services import painel
from frotas.ui import componentes as ui
from frotas.ui import rotas
from frotas.ui import sessao as ui_sessao

CHAVE = "manutencoes"
TIPOS = {"preventiva": "Preventiva (revisão)", "corretiva": "Corretiva (reparo)"}
MESES = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
]


def _opcoes_mes(n: int = 24) -> list[str | None]:
    h, opcoes = hoje(), [None]
    ano, mes = h.year, h.month
    for _ in range(n):
        opcoes.append(f"{ano}-{mes:02d}")
        ano, mes = (ano - 1, 12) if mes == 1 else (ano, mes - 1)
    return opcoes


def _rotulo_mes(valor: str | None) -> str:
    return "Todos os meses" if not valor else f"{MESES[int(valor[5:7]) - 1].capitalize()}/{valor[:4]}"


def pagina() -> None:
    sessao = ui_sessao.exigir()
    modo, _ = rotas.modo(CHAVE)
    _nova(sessao) if modo == "nova" else _lista(sessao)


def _lista(sessao) -> None:
    st.title("Manutenções e custos")
    c1, c2, c3, c4 = st.columns([2, 2, 2, 2], vertical_alignment="bottom")
    with c1:
        filial_id = ui.filtro_filial(sessao, "man_filial")
    tipo = c2.selectbox(
        "Tipo", [None, *TIPOS], format_func=lambda t: "Todos os tipos" if t is None else TIPOS[t], key="man_tipo"
    )
    mes = c3.selectbox("Mês", _opcoes_mes(), format_func=_rotulo_mes, key="man_mes")
    if c4.button("Registrar manutenção", icon=":material/add:", type="primary", width="stretch"):
        rotas.ir(CHAVE, "nova")

    filtro = svc.FiltroManutencao(filial_id=filial_id, tipo=tipo, mes=mes)
    pagina_n = ui.pagina_atual("man_pagina", (filial_id, tipo, mes))
    try:
        itens, total = svc.listar_manutencoes(sessao.client, filtro, pagina_n)
        custos = svc.totais_de_custo(sessao.client, filtro)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return

    k1, k2, k3 = st.columns(3)
    k1.metric("Custo total", brl(custos["total"]), border=True)
    k2.metric("Preventivas", brl(custos["preventiva"]), border=True)
    k3.metric("Corretivas", brl(custos["corretiva"]), border=True)

    st.caption(f"{total} lançamento(s)")
    if not itens:
        st.info("Nenhuma manutenção encontrada. Registre revisões e reparos para acompanhar custos e alertas.")
    for m in itens:
        with st.container(border=True):
            a, b = st.columns([4, 1], vertical_alignment="center")
            placa = formatar_placa(m["veiculo"]["placa"]) if m.get("veiculo") else "—"
            a.markdown(f"**{placa}** · {'Preventiva' if m['tipo'] == 'preventiva' else 'Corretiva'}")
            a.write(m["descricao"])
            local = f" · {filial_label(m['filial'])}" if sessao.is_admin and m.get("filial") else ""
            fornecedor = f" · {m['fornecedor']}" if m.get("fornecedor") else ""
            a.caption(f"{data_br(m['data_manutencao'])} · {km(m['km_registro'])}{fornecedor}{local}")
            with b:
                st.markdown(f"### {brl(m['custo'])}")
                if m["status_alerta"] != "ok":
                    ui.badge_alerta(m["status_alerta"])
                if sessao.is_admin:
                    ui.confirmar_exclusao(
                        f"man_del_{m['id']}",
                        "Excluir este lançamento de manutenção?",
                        lambda mid=m["id"]: svc.excluir_manutencao(sessao, mid),
                    )
                    if ui.foi_excluido(f"man_del_{m['id']}"):
                        st.rerun()
    ui.paginacao("man_pagina", total)


def _nova(sessao) -> None:
    st.title("Registrar manutenção")
    st.caption("Lance o serviço realizado e o custo. Os alertas de revisão são recalculados automaticamente.")
    try:
        veiculos = painel.todos_veiculos(sessao.client)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    if not veiculos:
        st.info("Cadastre um veículo antes de registrar manutenções.")
        return

    por_id = {v.id: v for v in veiculos}
    inicial = st.session_state.pop("manutencao_veiculo_inicial", None)
    if inicial in por_id:
        st.session_state["man_veiculo"] = inicial

    rotulos = {
        v.id: veiculo_label(v.dados)
        + (
            f" — {filial_label({'nome_cidade': v.dados['nome_cidade'], 'uf': v.dados['uf']})}"
            if sessao.is_admin
            else ""
        )
        for v in veiculos
    }
    # veículo e tipo ficam fora do formulário para o KM sugerido e o aviso acompanharem a escolha
    veiculo_id = st.selectbox(
        "Veículo *",
        list(rotulos),
        format_func=rotulos.get,
        index=None,
        placeholder="Selecione o veículo…",
        key="man_veiculo",
    )
    tipo = st.selectbox("Tipo *", list(TIPOS), format_func=TIPOS.get, key="man_tipo_form")
    v = por_id.get(veiculo_id) if veiculo_id else None
    if v and tipo == "preventiva":
        st.info(
            f"A próxima revisão será agendada automaticamente para **+{km(v.dados['intervalo_revisao_km'])}** ou "
            f"**+{v.dados['intervalo_revisao_dias']} dias** (o que ocorrer primeiro).",
            icon=":material/event:",
        )

    with st.form("man_form", border=True):
        c1, c2 = st.columns(2)
        data = c1.date_input("Data do serviço *", value=hoje(), max_value=hoje(), format="DD/MM/YYYY")
        km_servico = c2.number_input(
            "KM no serviço *",
            min_value=0,
            value=int(v.dados["km_atual"]) if v else 0,
            step=100,
            key=f"man_km_{veiculo_id}",
        )
        custo = c1.text_input("Custo (R$) *", placeholder="0,00")
        fornecedor = c2.text_input("Oficina / fornecedor")
        descricao = st.text_area("Descrição do serviço *", placeholder="Ex.: troca de óleo e filtros, alinhamento…")
        enviar = st.form_submit_button("Registrar manutenção", type="primary", width="stretch")
    if st.button("Cancelar", width="stretch"):
        rotas.ir(CHAVE)
    if not enviar:
        return
    try:
        r = svc.registrar_manutencao(
            sessao,
            {
                "veiculo_id": veiculo_id, "tipo": tipo, "descricao": descricao, "custo": custo,
                "km_registro": km_servico, "data_manutencao": data, "fornecedor": fornecedor,
            },
        )  # fmt: skip
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    if r.aviso:
        st.warning(r.aviso)
        return
    st.toast("Manutenção registrada.", icon="✅")
    rotas.ir(CHAVE)
