"""
Configuração a partir de variáveis de ambiente / st.secrets (Streamlit Community Cloud).

Segredos (Settings > Secrets, em TOML):
    SUPABASE_URL = "https://<projeto>.supabase.co"
    SUPABASE_ANON_KEY = "<anon/publishable key>"
    SUPABASE_SERVICE_ROLE_KEY = "<service role key>"   # só servidor; criar supervisores e cron

O Streamlit expõe os segredos de nível raiz também como variáveis de ambiente, então
ler de os.environ funciona na nuvem, localmente (.streamlit/secrets.toml) e nos scripts/CI.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigAusente(RuntimeError):
    """Falta alguma variável obrigatória."""


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str | None = None


def _ler(nome: str) -> str | None:
    valor = os.environ.get(nome)
    if valor:
        return valor.strip()
    try:  # fora do Streamlit (scripts/testes) st.secrets pode nem existir
        import streamlit as st

        segredo = st.secrets.get(nome)
        return str(segredo).strip() if segredo else None
    except Exception:
        return None


def carregar_config(exigir_anon: bool = True) -> Config:
    url = _ler("SUPABASE_URL")
    anon = _ler("SUPABASE_ANON_KEY")
    service = _ler("SUPABASE_SERVICE_ROLE_KEY")
    faltando = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_ANON_KEY", anon if exigir_anon else "-")) if not v]
    if faltando:
        raise ConfigAusente(
            f"Configuração ausente: {', '.join(faltando)}. Defina em .streamlit/secrets.toml (veja secrets.toml.example)."
        )
    return Config(supabase_url=url or "", supabase_anon_key=anon or "", supabase_service_role_key=service)
