"""
Sessão do usuário no Streamlit.

- O cliente Supabase autenticado (JWT do usuário => RLS) vive em st.session_state, UM POR SESSÃO de navegador.
- Para sobreviver a recarregamentos/quedas de conexão do celular, o refresh token é guardado num cookie do navegador
  (SameSite=Strict, Secure em https) e a sessão é retomada na próxima conexão. O token gira a cada renovação
  (uso único), então um cookie roubado deixa de valer assim que o dono renova a sessão. Sair apaga o cookie
  e revoga a sessão no Supabase.
"""

from __future__ import annotations

import json
from urllib.parse import unquote

import streamlit as st

from frotas.infra import auth
from frotas.infra.auth import Sessao
from frotas.infra.config import carregar_config
from frotas.infra.erros import ErroNegocio

CHAVE = "_sessao"
COOKIE = "frotas_rt"
VALIDADE_COOKIE_S = 14 * 24 * 3600


def _js_gravar_cookie(valor: str | None) -> str:
    expira = f"max-age={VALIDADE_COOKIE_S}" if valor else "max-age=0"
    return f"""<script>
(function () {{
  var secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = {json.dumps(COOKIE)} + "=" + encodeURIComponent({json.dumps(valor or "")})
    + "; path=/; {expira}; SameSite=Strict" + secure;
}})();
</script>"""


def _agendar_cookie(valor: str | None) -> None:
    # o JS só pode rodar quando renderizado; guardamos para a próxima renderização do entrypoint
    st.session_state["_cookie_js"] = _js_gravar_cookie(valor)


def aplicar_cookie_pendente() -> None:
    js = st.session_state.pop("_cookie_js", None)
    if js:
        st.html(js, unsafe_allow_javascript=True)


def _guardar(sessao: Sessao) -> Sessao:
    st.session_state[CHAVE] = sessao
    _agendar_cookie(sessao.refresh_token)
    return sessao


def obter() -> Sessao | None:
    """Sessão atual (renovando o token se preciso) ou None. Tenta retomar pelo cookie na 1ª execução."""
    sessao: Sessao | None = st.session_state.get(CHAVE)
    if sessao:
        try:
            if auth.renovar_se_preciso(sessao):
                _agendar_cookie(sessao.refresh_token)
        except ErroNegocio:
            limpar()
            return None
        return sessao

    token = st.context.cookies.get(COOKIE)
    if token and not st.session_state.get("_restauracao_tentada"):
        st.session_state["_restauracao_tentada"] = True
        try:
            return _guardar(auth.restaurar(carregar_config(), unquote(token)))
        except ErroNegocio:
            _agendar_cookie(None)  # cookie inválido/expirado
    return None


def exigir() -> Sessao:
    """Para as páginas: garante sessão (defesa em profundidade; o entrypoint já barra quem não entrou)."""
    sessao = obter()
    if not sessao:
        st.warning("Sua sessão expirou. Entre novamente.")
        st.stop()
    return sessao


def exigir_admin() -> Sessao:
    sessao = exigir()
    if not sessao.is_admin:
        st.error("Você não tem permissão para acessar esta área.")
        st.stop()
    return sessao


def entrar(email: str, senha: str) -> Sessao:
    return _guardar(auth.entrar(carregar_config(), email, senha))


def limpar() -> None:
    for chave in list(st.session_state.keys()):
        del st.session_state[chave]
    st.session_state["_restauracao_tentada"] = True
    _agendar_cookie(None)


def sair() -> None:
    sessao: Sessao | None = st.session_state.get(CHAVE)
    if sessao:
        auth.sair(sessao)
    limpar()
