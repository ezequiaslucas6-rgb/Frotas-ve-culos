"""Fábrica de clientes Supabase."""

from __future__ import annotations

from functools import cache

from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from frotas.infra.config import Config, carregar_config


def criar_cliente_usuario(config: Config) -> Client:
    """
    Cliente NOVO (um por sessão de navegador). Após o login o supabase-py injeta o JWT do
    usuário nos headers do PostgREST e do Storage => a RLS do Postgres vale em toda consulta.

    Nunca compartilhe esta instância entre usuários (nada de st.cache_resource aqui).
    A renovação do token é manual (ver infra.auth.renovar_se_preciso): sem threads em background.
    """
    return create_client(
        config.supabase_url,
        config.supabase_anon_key,
        options=SyncClientOptions(auto_refresh_token=False, persist_session=True, storage_client_timeout=60),
    )


@cache
def cliente_admin() -> Client:
    """
    Cliente com a SERVICE ROLE KEY: ignora a RLS. Uso restrito a código de servidor que PRECISA
    de privilégios elevados (criar usuários do Auth, cron). Valide SEMPRE a permissão do chamador
    (sessao.exigir_admin()) antes de usá-lo. Não mantém sessão nem estado de usuário.
    """
    config = carregar_config(exigir_anon=False)
    if not config.supabase_service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY é obrigatória para operações administrativas.")
    return create_client(
        config.supabase_url,
        config.supabase_service_role_key,
        options=SyncClientOptions(auto_refresh_token=False, persist_session=False),
    )
