"""CSS global: layout compacto e alvos de toque maiores no celular."""

from __future__ import annotations

import streamlit as st

CSS = """
<style>
.block-container { padding-top: 2.2rem; padding-bottom: 5rem; max-width: 1100px; }
/* o wizard de checklist usa uma coluna estreita, mesmo no desktop */
.st-key-wizard { max-width: 640px; margin-inline: auto; }
[data-testid="stMetricValue"] { font-size: 1.6rem; }
@media (max-width: 640px) {
  .block-container { padding-left: .9rem; padding-right: .9rem; padding-top: 1.2rem; }
  .stButton > button, .stDownloadButton > button, [data-testid="stBaseLinkButton-secondary"],
  [data-testid="stBaseLinkButton-primary"] { min-height: 3rem; font-size: 1.02rem; }
  [data-testid="stMetricValue"] { font-size: 1.35rem; }
  h1 { font-size: 1.6rem !important; }
}
/* barra de progresso do wizard: quadrados coloridos por etapa */
.progresso-etapas { font-size: 1.15rem; letter-spacing: .08rem; line-height: 1.6; }
</style>
"""


def aplicar() -> None:
    st.markdown(CSS, unsafe_allow_html=True)
