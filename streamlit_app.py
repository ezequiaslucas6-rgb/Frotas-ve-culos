"""
Gestão de Frotas — entrypoint do Streamlit.

    streamlit run streamlit_app.py

Fluxo: carrega a sessão (ou retoma pelo cookie) -> sem sessão mostra o login -> com sessão monta a navegação
conforme o papel (Admin ou Supervisor). A autorização REAL dos dados é a RLS do Postgres; a navegação por papel
é UX e defesa em profundidade (as páginas de admin também validam a sessão).
"""

from __future__ import annotations

import streamlit as st

st.set_page_config(
    page_title="Gestão de Frotas",
    page_icon="🚚",
    layout="wide",
    initial_sidebar_state="auto",
    menu_items={"About": "Gestão de Frotas multi-filial · Streamlit + Supabase"},
)

from frotas.domain.formatos import filial_label  # noqa: E402
from frotas.infra.config import ConfigAusente  # noqa: E402
from frotas.paginas import (  # noqa: E402
    checklist_novo,
    checklists,
    dashboard,
    filiais,
    login,
    manutencoes,
    motoristas,
    supervisores,
    veiculos,
)
from frotas.ui import estilo, rotas  # noqa: E402
from frotas.ui import sessao as ui_sessao  # noqa: E402


def _montar_navegacao(sessao):
    pagina = {
        "painel": st.Page(
            dashboard.pagina, title="Painel", icon=":material/dashboard:", url_path="painel", default=True
        ),
        "checklists": st.Page(
            checklists.pagina, title="Checklists", icon=":material/fact_check:", url_path="checklists"
        ),
        "checklist_novo": st.Page(
            checklist_novo.pagina, title="Novo checklist", icon=":material/add_a_photo:", url_path="novo-checklist"
        ),
        "veiculos": st.Page(veiculos.pagina, title="Veículos", icon=":material/local_shipping:", url_path="veiculos"),
        "motoristas": st.Page(motoristas.pagina, title="Motoristas", icon=":material/badge:", url_path="motoristas"),
        "manutencoes": st.Page(
            manutencoes.pagina, title="Manutenções", icon=":material/build:", url_path="manutencoes"
        ),
    }
    operacao = list(pagina.values())
    if not sessao.is_admin:
        rotas.registrar(pagina)
        return st.navigation(operacao)

    admin = {
        "filiais": st.Page(filiais.pagina, title="Filiais", icon=":material/location_city:", url_path="filiais"),
        "supervisores": st.Page(
            supervisores.pagina, title="Supervisores", icon=":material/manage_accounts:", url_path="supervisores"
        ),
    }
    rotas.registrar({**pagina, **admin})
    return st.navigation({"Operação": operacao, "Administração": list(admin.values())})


def _barra_lateral(sessao) -> None:
    with st.sidebar:
        st.markdown("### 🚚 Gestão de Frotas")
        st.markdown(f"**{sessao.perfil.nome}**")
        papel = "Administrador Geral" if sessao.is_admin else "Supervisor"
        local = f" · {filial_label(sessao.perfil.filial)}" if sessao.perfil.filial else ""
        st.caption(f"{papel}{local}")
        if st.button("Sair", icon=":material/logout:", width="stretch"):
            ui_sessao.sair()
            st.rerun()


def main() -> None:
    estilo.aplicar()
    try:
        sessao = ui_sessao.obter()
    except ConfigAusente as exc:
        st.error(str(exc))
        st.stop()
    ui_sessao.aplicar_cookie_pendente()

    if sessao is None:
        login.pagina_login()
        st.stop()

    pg = _montar_navegacao(sessao)
    _barra_lateral(sessao)
    pg.run()


main()
