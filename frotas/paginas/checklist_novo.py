"""
Wizard do checklist (14 fotos obrigatórias), pensado para o celular.

Fluxo: identificação -> 14 etapas (foto + condição + observação) -> revisão -> envio.

- Câmera: aba "Câmera do celular / arquivo" (abre a câmera traseira nativa no celular) e aba "Webcam".
- Cada foto é comprimida (Pillow) e enviada ao Storage NA HORA (etapa a etapa): uma queda de conexão
  não perde as fotos já enviadas. O envio final só leva metadados (RPC atômica no Postgres).
- Marcadores de avaria: clique sobre a foto para fixar pins numerados; o primeiro pin já marca a etapa como "Atenção".
- Status geral e contadores em tempo real no topo.
- Rascunho: os metadados ficam em public.checklist_rascunhos; se a sessão cair (celular bloqueado, sinal
  fraco), o app oferece continuar de onde parou.
"""

from __future__ import annotations

import io

import httpx
import streamlit as st
from PIL import Image, UnidentifiedImageError

from frotas.domain.checklist import (
    CATEGORIAS,
    ETAPAS,
    SEVERIDADE_ICONE,
    SEVERIDADE_LABEL,
    SEVERIDADES,
    TOTAL_ETAPAS,
    contar_severidades,
    status_geral,
)
from frotas.domain.documentos import formatar_placa
from frotas.domain.formatos import filial_label, km
from frotas.domain.imagens import desenhar_marcadores, formatar_bytes
from frotas.infra import storage
from frotas.infra.erros import ErroNegocio
from frotas.services import checklists as svc
from frotas.services import motoristas as motoristas_svc
from frotas.services import painel, rascunhos
from frotas.services.base import novo_uuid
from frotas.ui import componentes as ui
from frotas.ui import rotas
from frotas.ui import sessao as ui_sessao

try:  # componente opcional: sem ele o app funciona, apenas sem marcar pins na foto
    from streamlit_image_coordinates import streamlit_image_coordinates
except ImportError:  # pragma: no cover
    streamlit_image_coordinates = None

KEY = "wiz"
PASSO_REVISAO = TOTAL_ETAPAS + 1
COR_QUADRADO = {"ok": "🟩", "atencao": "🟨", "critico": "🟥"}


# ----------------------------------------------------------------------------- estado
def _etapa_vazia() -> dict:
    return {
        "path": None,  # caminho no Storage após o upload
        "preview": None,  # bytes JPEG (acabou de enviar) ou URL assinada (rascunho restaurado)
        "tamanho": "",
        "severidade": "ok",
        "observacao": "",
        "marcadores": [],
        "captura": 0,  # sufixo das keys dos widgets de upload (permite "refazer")
        "ultimo_clique": None,
        "falha_id": None,  # arquivo cujo envio falhou (evita repetir sozinho a cada rerun)
    }


def _novo_wiz() -> dict:
    return {
        "id": novo_uuid(),  # gerado antes: as fotos sobem para <filial>/<checklist>/ ANTES do envio final
        "passo": 0,
        "veiculo": None,
        "motorista_id": None,
        "km": None,
        "obs": "",
        "etapas": {c: _etapa_vazia() for c in CATEGORIAS},
    }


def _snapshot_veiculo(v: painel.VeiculoPainel) -> dict:
    d = v.dados
    return {k: d.get(k) for k in ("id", "filial_id", "placa", "marca", "modelo", "km_atual", "nome_cidade", "uf")}


def _fotos_enviadas(wiz: dict) -> int:
    return sum(e["path"] is not None for e in wiz["etapas"].values())


def _km_valido(wiz: dict) -> bool:
    return wiz["km"] is not None and wiz["veiculo"] is not None and wiz["km"] >= wiz["veiculo"]["km_atual"]


def _etapa_valida(wiz: dict, categoria: str) -> bool:
    e = wiz["etapas"][categoria]
    ok = e["path"] is not None and (e["severidade"] == "ok" or bool(e["observacao"].strip()))
    return ok and _km_valido(wiz) if categoria == "painel" else ok


def _limpar_widgets() -> None:
    prefixos = ("sev_", "obs_", "up_", "cam_", "pin_", "marc_", "wiz_")
    for chave in [k for k in st.session_state if isinstance(k, str) and k.startswith(prefixos)]:
        del st.session_state[chave]


# ----------------------------------------------------------------------------- rascunho
def _salvar_rascunho(sessao, wiz: dict) -> None:
    if not wiz["veiculo"] or _fotos_enviadas(wiz) == 0:
        return
    etapas = {
        cat: {
            "path": e["path"],
            "severidade": e["severidade"],
            "observacao": e["observacao"],
            "marcadores": e["marcadores"],
        }
        for cat, e in wiz["etapas"].items()
        if e["path"]
    }
    rascunhos.salvar_rascunho(
        sessao.client,
        sessao.user_id,
        {
            "checklist_id": wiz["id"],
            "veiculo_id": wiz["veiculo"]["id"],
            "motorista_id": wiz["motorista_id"],
            "km": wiz["km"],
            "obs": wiz["obs"],
            "passo": wiz["passo"],
            "etapas": etapas,
        },
    )


def _restaurar(sessao, rasc: dict) -> dict | None:
    v = painel.obter_veiculo(sessao.client, rasc["veiculo_id"])
    if not v:
        return None
    wiz = _novo_wiz()
    wiz.update(
        id=rasc["checklist_id"],
        veiculo=_snapshot_veiculo(v),
        motorista_id=rasc.get("motorista_id"),
        km=rasc.get("km"),
        obs=rasc.get("obs", ""),
        passo=max(1, int(rasc.get("passo", 1))),
    )
    urls = storage.urls_assinadas(
        sessao.client, storage.BUCKET_CHECKLISTS, [e["path"] for e in rasc["etapas"].values()]
    )
    for cat, e in rasc["etapas"].items():
        # foto que não está mais no Storage volta a ser "vazia" (precisa ser refeita)
        if cat in wiz["etapas"] and e["path"] in urls:
            wiz["etapas"][cat].update(
                path=e["path"],
                preview=urls[e["path"]],
                severidade=e["severidade"],
                observacao=e.get("observacao", ""),
                marcadores=e.get("marcadores", []),
            )
    return wiz


def _iniciar(sessao) -> dict:
    """Primeira renderização: oferece continuar um rascunho salvo ou começa um checklist novo."""
    pre = st.session_state.pop("checklist_veiculo_inicial", None)
    if pre:
        st.session_state["wiz_veiculo_pre"] = pre
    rasc = rascunhos.carregar_rascunho(sessao.client, sessao.user_id)
    if rasc and rasc.get("etapas"):
        st.title("Novo checklist")
        st.info(
            f"Há um checklist em andamento com **{len(rasc['etapas'])}/{TOTAL_ETAPAS} fotos**. Deseja continuar de onde parou?",
            icon=":material/history:",
        )
        c1, c2 = st.columns(2)
        if c1.button("Continuar", type="primary", width="stretch", key="wiz_continuar"):
            with st.spinner("Restaurando…"):
                wiz = _restaurar(sessao, rasc)
            if wiz:
                st.session_state[KEY] = wiz
                st.toast("Checklist em andamento restaurado.", icon="✅")
            else:
                rascunhos.apagar_rascunho(sessao.client, sessao.user_id)
                st.toast("O veículo do rascunho não está mais disponível. Começando um novo checklist.", icon="⚠️")
            st.rerun()
        if c2.button("Descartar", icon=":material/delete:", width="stretch", key="wiz_descartar"):
            rascunhos.apagar_rascunho(sessao.client, sessao.user_id)
            st.rerun()
        st.stop()
    wiz = _novo_wiz()
    st.session_state[KEY] = wiz
    return wiz


def _cancelar(sessao) -> None:
    rascunhos.apagar_rascunho(sessao.client, sessao.user_id)
    st.session_state.pop(KEY, None)
    _limpar_widgets()
    rotas.abrir("checklists")


# ----------------------------------------------------------------------------- página
def pagina() -> None:
    sessao = ui_sessao.exigir()
    with st.container(key="wizard"):
        wiz = st.session_state.get(KEY) or _iniciar(sessao)
        _cabecalho(wiz)
        passo = wiz["passo"]
        if passo == 0:
            _passo_identificacao(sessao, wiz)
        elif passo <= TOTAL_ETAPAS:
            _passo_foto(sessao, wiz, passo)
        else:
            _passo_revisao(sessao, wiz)
        with st.expander("Cancelar este checklist", icon=":material/close:"):
            st.caption("As fotos já enviadas serão descartadas do rascunho.")
            if st.button("Cancelar checklist", key="wiz_cancelar", width="stretch"):
                _cancelar(sessao)


def _cabecalho(wiz: dict) -> None:
    st.title("Novo checklist")
    enviadas = _fotos_enviadas(wiz)
    severidades = [e["severidade"] for e in wiz["etapas"].values() if e["path"]]
    quadrados = []
    for i, cat in enumerate(CATEGORIAS, start=1):
        e = wiz["etapas"][cat]
        quadrados.append(COR_QUADRADO[e["severidade"]] if e["path"] else ("🟦" if i == wiz["passo"] else "⬜"))
    st.markdown(f'<div class="progresso-etapas">{"".join(quadrados)}</div>', unsafe_allow_html=True)
    st.progress(
        enviadas / TOTAL_ETAPAS,
        text=f"{enviadas}/{TOTAL_ETAPAS} fotos" + (f" · {wiz['veiculo']['placa']}" if wiz["veiculo"] else ""),
    )
    if severidades:
        contagem = contar_severidades(severidades)
        a, b = st.columns([3, 1], vertical_alignment="center")
        a.caption(f"{contagem['ok']} ok · {contagem['atencao']} atenção · {contagem['critico']} avaria")
        with b:
            ui.badge_checklist(status_geral(severidades))


# ----------------------------------------------------------------------------- passo 0
def _passo_identificacao(sessao, wiz: dict) -> None:
    st.subheader("Identificação")
    st.write(f"Escolha o veículo e o motorista. Depois serão {TOTAL_ETAPAS} fotos obrigatórias.")
    try:
        veiculos = painel.todos_veiculos(sessao.client)
    except ErroNegocio as exc:
        ui.mostrar_erro(exc)
        return
    if not veiculos:
        st.warning("Cadastre um veículo antes de iniciar um checklist.")
        if st.button("Cadastrar veículo", type="primary"):
            rotas.abrir("veiculos", "novo")
        return

    por_id = {v.id: v for v in veiculos}
    rotulos = {
        v.id: f"{formatar_placa(v.dados['placa'])}"
        + (f" · {v.dados['modelo']}" if v.dados.get("modelo") else "")
        + (
            f" — {filial_label({'nome_cidade': v.dados['nome_cidade'], 'uf': v.dados['uf']})}"
            if sessao.is_admin
            else ""
        )
        for v in veiculos
    }
    atual = wiz["veiculo"]["id"] if wiz["veiculo"] else st.session_state.pop("wiz_veiculo_pre", None)
    bloqueado = _fotos_enviadas(wiz) > 0
    veiculo_id = st.selectbox(
        "Veículo *",
        list(rotulos),
        format_func=rotulos.get,
        index=list(rotulos).index(atual) if atual in rotulos else None,
        placeholder="Selecione o veículo…",
        key="wiz_sel_veiculo",
        disabled=bloqueado,
        help="Para trocar de veículo, cancele este checklist." if bloqueado else None,
    )
    motorista_id = None
    if veiculo_id:
        v = por_id[veiculo_id]
        ativos = motoristas_svc.listar_ativos(sessao.client, filial_id=v.dados["filial_id"])
        nomes = {m["id"]: m["nome"] for m in ativos}
        if not nomes:
            st.warning("Nenhum motorista ativo nesta filial.")
            if st.button("Cadastrar motorista"):
                rotas.abrir("motoristas", "novo")
        else:
            anterior = wiz["motorista_id"] if wiz["motorista_id"] in nomes else None
            motorista_id = st.selectbox(
                "Motorista *",
                list(nomes),
                format_func=nomes.get,
                index=list(nomes).index(anterior) if anterior else None,
                placeholder="Selecione o motorista…",
                key="wiz_sel_motorista",
            )

    pronto = bool(veiculo_id and motorista_id)
    if st.button("Começar", type="primary", disabled=not pronto, width="stretch", key="wiz_comecar"):
        v = por_id[veiculo_id]
        wiz["veiculo"] = _snapshot_veiculo(v)
        wiz["motorista_id"] = motorista_id
        if wiz["km"] is None or wiz["km"] < v.dados["km_atual"]:
            wiz["km"] = v.dados["km_atual"]
        wiz["passo"] = 1
        st.rerun()


# ----------------------------------------------------------------------------- passos 1..14
def _bytes_da_foto(est: dict) -> bytes | None:
    """Bytes da foto (de um upload recente ou baixados da URL assinada de um rascunho restaurado)."""
    preview = est["preview"]
    if isinstance(preview, bytes):
        return preview
    if isinstance(preview, str):
        try:
            resposta = httpx.get(preview, timeout=30)
            resposta.raise_for_status()
            Image.open(io.BytesIO(resposta.content)).verify()  # garante que é mesmo uma imagem
        except (httpx.HTTPError, UnidentifiedImageError, OSError):
            return None
        est["preview"] = resposta.content
        return est["preview"]
    return None


def _passo_foto(sessao, wiz: dict, passo: int) -> None:
    etapa = ETAPAS[passo - 1]
    est = wiz["etapas"][etapa.categoria]
    st.caption(f"ETAPA {passo} DE {TOTAL_ETAPAS}")
    st.subheader(etapa.titulo)
    st.write(etapa.dica)

    if est["path"] is None:
        _captura(sessao, wiz, etapa, est)
    else:
        _preview(sessao, wiz, etapa, est)

    if etapa.categoria == "painel":
        minimo = wiz["veiculo"]["km_atual"]
        valor = st.number_input(
            "KM do hodômetro *",
            min_value=0,
            value=int(wiz["km"] if wiz["km"] is not None else minimo),
            step=1,
            key="wiz_km",
            help=f"Último KM registrado: {km(minimo)}",
        )
        wiz["km"] = int(valor)
        if not _km_valido(wiz):
            st.error(f"O KM não pode ser menor que o último registrado ({km(minimo)}).")

    if est["path"] is not None:
        _condicao(est, etapa.categoria)

    _navegacao(sessao, wiz, passo, _motivo_bloqueio(wiz, etapa, est))


def _captura(sessao, wiz: dict, etapa, est: dict) -> None:
    n = est["captura"]
    aba_celular, aba_webcam = st.tabs(
        [":material/photo_camera: Tirar foto / escolher arquivo", ":material/videocam: Webcam"]
    )
    with aba_celular:
        arquivo = st.file_uploader(
            "Foto", type=["jpg", "jpeg", "png", "webp"], key=f"up_{etapa.categoria}_{n}", label_visibility="collapsed",
            help="No celular, toque aqui e escolha 'Tirar foto'.",
        )  # fmt: skip
    with aba_webcam:
        webcam = st.camera_input("Foto", key=f"cam_{etapa.categoria}_{n}", label_visibility="collapsed")
    escolhido = arquivo or webcam
    if escolhido is None:
        return

    if est["falha_id"] == escolhido.file_id:  # já tentamos este arquivo e falhou
        st.error("Não foi possível enviar a foto. Verifique a conexão.")
        if st.button("Tentar novamente", icon=":material/refresh:", key=f"retry_{etapa.categoria}", width="stretch"):
            est["falha_id"] = None
            st.rerun()
        return

    with st.spinner("Comprimindo e enviando a foto…"):
        try:
            caminho, img = svc.enviar_foto_etapa(
                sessao, wiz["veiculo"]["filial_id"], wiz["id"], etapa.categoria, escolhido.getvalue()
            )
        except ErroNegocio as exc:
            est["falha_id"] = escolhido.file_id
            st.error(exc.mensagem)
            return
    est.update(
        path=caminho,
        preview=img.dados,
        tamanho=f"{formatar_bytes(img.tamanho_original)} → {formatar_bytes(img.tamanho)}",
        marcadores=[],
        ultimo_clique=None,
        falha_id=None,
        captura=n + 1,
    )
    _salvar_rascunho(sessao, wiz)
    st.rerun()


def _preview(sessao, wiz: dict, etapa, est: dict) -> None:
    dados = _bytes_da_foto(est)
    if dados is None:
        st.warning("Não foi possível carregar a foto. Refaça a captura.")
    else:
        marcando = streamlit_image_coordinates is not None and st.toggle(
            "Marcar avaria na foto (toque na imagem)",
            key=f"marc_{etapa.categoria}",
            help="Cada toque fixa um pin numerado.",
        )
        if marcando:
            clique = streamlit_image_coordinates(
                desenhar_marcadores(dados, est["marcadores"]),
                key=f"pin_{etapa.categoria}_{est['captura']}",
                width="stretch",
            )
            if (
                clique
                and clique.get("unix_time") != est["ultimo_clique"]
                and len(est["marcadores"]) < svc.MAX_MARCADORES
            ):
                est["ultimo_clique"] = clique["unix_time"]
                est["marcadores"].append(
                    {
                        "x": round(clique["x"] / clique["width"] * 100, 1),
                        "y": round(clique["y"] / clique["height"] * 100, 1),
                    }
                )
                if est["severidade"] == "ok":  # um pin de avaria já sinaliza a etapa (ajustável abaixo)
                    est["severidade"] = "atencao"
                    st.session_state[f"sev_{etapa.categoria}"] = "atencao"
                st.rerun()
        else:
            st.image(desenhar_marcadores(dados, est["marcadores"]) if est["marcadores"] else dados, width="stretch")
        st.caption(f"✅ Enviada · {est['tamanho']}" if est["tamanho"] else "✅ Enviada")

    c1, c2 = st.columns(2)
    if c1.button("Refazer foto", icon=":material/refresh:", key=f"refazer_{etapa.categoria}", width="stretch"):
        est.update(path=None, preview=None, tamanho="", marcadores=[], ultimo_clique=None, captura=est["captura"] + 1)
        st.session_state.pop(f"marc_{etapa.categoria}", None)
        st.rerun()
    if est["marcadores"] and c2.button(
        "Limpar marcadores", icon=":material/location_off:", key=f"limpar_{etapa.categoria}", width="stretch"
    ):
        est["marcadores"] = []
        st.rerun()


def _condicao(est: dict, categoria: str) -> None:
    chave_sev, chave_obs = f"sev_{categoria}", f"obs_{categoria}"
    if chave_sev not in st.session_state:
        st.session_state[chave_sev] = est["severidade"]
    if chave_obs not in st.session_state:
        st.session_state[chave_obs] = est["observacao"]
    est["severidade"] = st.radio(
        "Condição deste item",
        SEVERIDADES,
        format_func=lambda s: f"{SEVERIDADE_ICONE[s]} {SEVERIDADE_LABEL[s]}",
        horizontal=True,
        key=chave_sev,
    )
    if est["severidade"] != "ok":
        est["observacao"] = st.text_area(
            "Descreva a inconformidade *",
            key=chave_obs,
            max_chars=1000,
            placeholder="Ex.: pneu dianteiro esquerdo careca; amassado na porta…",
        )


def _motivo_bloqueio(wiz: dict, etapa, est: dict) -> str | None:
    if est["path"] is None:
        return "Tire a foto desta etapa para continuar."
    if est["severidade"] != "ok" and not est["observacao"].strip():
        return "Descreva a inconformidade para continuar."
    if etapa.categoria == "painel" and not _km_valido(wiz):
        return f"Informe o KM do hodômetro (mínimo {wiz['veiculo']['km_atual']})."
    return None


def _navegacao(sessao, wiz: dict, passo: int, bloqueio: str | None) -> None:
    if bloqueio:
        st.caption(f":material/info: {bloqueio}")
    voltar, avancar = st.columns([1, 2])
    if voltar.button("Voltar", icon=":material/arrow_back:", key="wiz_voltar", width="stretch"):
        wiz["passo"] = passo - 1
        _salvar_rascunho(sessao, wiz)
        st.rerun()
    rotulo = "Revisar" if passo == TOTAL_ETAPAS else "Próxima"
    if avancar.button(
        rotulo,
        icon=":material/arrow_forward:",
        icon_position="right",
        type="primary",
        disabled=bloqueio is not None,
        key="wiz_avancar",
        width="stretch",
    ):
        wiz["passo"] = passo + 1
        _salvar_rascunho(sessao, wiz)
        st.rerun()


# ----------------------------------------------------------------------------- revisão e envio
def _passo_revisao(sessao, wiz: dict) -> None:
    st.subheader("Revisão final")
    st.write("Confira as fotos. Use **Editar** para ajustar uma etapa.")
    colunas = st.columns(3)
    for i, etapa in enumerate(ETAPAS, start=1):
        est = wiz["etapas"][etapa.categoria]
        with colunas[(i - 1) % 3], st.container(border=True):
            foto = _bytes_da_foto(est)
            if foto:
                st.image(desenhar_marcadores(foto, est["marcadores"]) if est["marcadores"] else foto, width="stretch")
            st.caption(f"{SEVERIDADE_ICONE[est['severidade']]} {i}. {etapa.titulo}")
            if st.button("Editar", key=f"wiz_ed_{i}", width="stretch"):
                wiz["passo"] = i
                st.rerun()

    wiz["obs"] = st.text_area(
        "Observações gerais", value=wiz["obs"], max_chars=2000, placeholder="Algo mais que o supervisor precise saber?"
    )

    pendentes = [e.titulo for e in ETAPAS if not _etapa_valida(wiz, e.categoria)]
    if pendentes:
        st.warning("Faltam ajustes nas etapas: " + ", ".join(pendentes))
    voltar, enviar = st.columns([1, 2])
    if voltar.button("Voltar", icon=":material/arrow_back:", key="wiz_voltar_rev", width="stretch"):
        wiz["passo"] = TOTAL_ETAPAS
        st.rerun()
    if enviar.button(
        "Enviar checklist",
        icon=":material/send:",
        type="primary",
        disabled=bool(pendentes),
        key="wiz_enviar",
        width="stretch",
    ):
        _enviar(sessao, wiz)


def _enviar(sessao, wiz: dict) -> None:
    entrada = svc.EntradaChecklist(
        checklist_id=wiz["id"],
        veiculo_id=wiz["veiculo"]["id"],
        motorista_id=wiz["motorista_id"],
        km_atual=int(wiz["km"]),
        observacoes_gerais=wiz["obs"] or None,
        itens=tuple(
            svc.ItemChecklist(
                categoria=cat,
                foto_path=wiz["etapas"][cat]["path"],
                severidade=wiz["etapas"][cat]["severidade"],
                observacao=wiz["etapas"][cat]["observacao"] or None,
                marcadores=tuple(wiz["etapas"][cat]["marcadores"]),
            )
            for cat in CATEGORIAS
        ),
    )
    try:
        with st.spinner("Enviando checklist…"):
            resultado = svc.salvar_checklist(sessao, entrada)
    except ErroNegocio as exc:
        st.error(exc.mensagem)
        return
    rascunhos.apagar_rascunho(sessao.client, sessao.user_id)
    st.session_state.pop(KEY, None)
    _limpar_widgets()
    st.toast("Checklist enviado com sucesso!", icon="✅")
    rotas.abrir("checklists", "detalhe", resultado.id)
