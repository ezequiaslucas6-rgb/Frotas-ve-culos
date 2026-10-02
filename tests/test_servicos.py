"""Serviços exercitados pelo supabase-py REAL contra o Supabase falso (HTTP de verdade)."""

from __future__ import annotations

import io
import uuid
from datetime import date, timedelta

import pytest
from PIL import Image

from frotas.domain.checklist import CATEGORIAS, caminho_foto
from frotas.domain.dates import hoje
from frotas.infra import auth, storage
from frotas.infra.cliente import cliente_admin
from frotas.infra.erros import ErroNegocio, ErroValidacao
from frotas.services import (
    alertas,
    checklists,
    dashboard,
    filiais,
    manutencoes,
    motoristas,
    painel,
    rascunhos,
    supervisores,
    veiculos,
)


def _login(config, email: str):
    return auth.entrar(config, email, "senha-correta")


@pytest.fixture
def sup_sp(config, fake):
    return _login(config, "sup.sp@frotas.com")


@pytest.fixture
def sup_rj(config, fake):
    return _login(config, "sup.rj@frotas.com")


@pytest.fixture
def admin(config, fake):
    return _login(config, "admin@frotas.com")


# ----------------------------------------------------------------------------- auth
class TestAuth:
    def test_login_supervisor_carrega_perfil_e_filial(self, sup_sp, fake):
        assert not sup_sp.is_admin
        assert sup_sp.perfil.nome == "Carlos Supervisor"
        assert sup_sp.filial_id == fake.dados["sp"]["id"]
        assert sup_sp.perfil.filial["uf"] == "SP"

    def test_login_admin(self, admin):
        assert admin.is_admin and admin.filial_id is None

    def test_credenciais_invalidas(self, config):
        with pytest.raises(ErroNegocio, match="inválidos"):
            auth.entrar(config, "sup.sp@frotas.com", "errada")

    def test_usuario_sem_perfil_nao_entra(self, config):
        with pytest.raises(auth.SemPerfil, match="não foi habilitado"):
            auth.entrar(config, "sem.perfil@frotas.com", "senha-correta")

    def test_restaurar_pelo_refresh_token_com_rotacao(self, config, sup_sp):
        antigo = sup_sp.refresh_token
        restaurada = auth.restaurar(config, antigo)
        assert restaurada.user_id == sup_sp.user_id
        assert restaurada.refresh_token != antigo
        with pytest.raises(ErroNegocio, match="expirada"):  # refresh token é de uso único
            auth.restaurar(config, antigo)

    def test_renovacao_so_perto_de_expirar(self, sup_sp):
        assert auth.renovar_se_preciso(sup_sp) is False
        antigo = sup_sp.refresh_token
        sup_sp.expires_at = 0
        assert auth.renovar_se_preciso(sup_sp) is True
        assert sup_sp.refresh_token != antigo
        # o cliente continua funcional com o novo token
        assert painel.todos_veiculos(sup_sp.client)

    def test_renovacao_com_token_invalido_exige_novo_login(self, sup_sp):
        sup_sp.refresh_token = "lixo"
        sup_sp.expires_at = 0
        with pytest.raises(ErroNegocio, match="expirou"):
            auth.renovar_se_preciso(sup_sp)

    def test_filial_alvo_ignora_o_formulario_do_supervisor(self, sup_sp, admin, fake):
        rj = fake.dados["rj"]["id"]
        assert sup_sp.filial_alvo(rj) == fake.dados["sp"]["id"]
        assert admin.filial_alvo(rj) == rj
        assert admin.filial_alvo(None) is None

    def test_operacoes_de_admin_barradas_para_supervisor(self, sup_sp, fake):
        with pytest.raises(ErroNegocio, match="permissão"):
            filiais.salvar_filial(sup_sp, {"nome_cidade": "Curitiba", "uf": "PR"})
        with pytest.raises(ErroNegocio, match="permissão"):
            veiculos.excluir_veiculo(sup_sp, fake.dados["v"][0]["id"])
        with pytest.raises(ErroNegocio, match="permissão"):
            supervisores.criar_supervisor(sup_sp, {})


# ----------------------------------------------------------------------------- painel / escopo
class TestPainel:
    def test_supervisor_ve_so_a_propria_filial_e_admin_ve_tudo(self, sup_sp, admin):
        assert {v.dados["placa"] for v in painel.todos_veiculos(sup_sp.client)} == {"ABC1D23", "XYZ9K88", "JKL4E56"}
        assert len(painel.todos_veiculos(admin.client)) == 4
        assert {
            v.dados["placa"] for v in painel.todos_veiculos(admin.client, admin.escopo_filial("x" * 0 or None))
        } >= {"RJO1A11"}

    def test_saude_e_alertas_calculados(self, admin):
        por_placa = {v.dados["placa"]: v for v in painel.todos_veiculos(admin.client)}
        assert por_placa["XYZ9K88"].avaliacao.saude == "manutencao"  # 90.000 km >= 89.000 => revisão vencida
        assert por_placa["XYZ9K88"].avaliacao.alerta.nivel == "vencido"
        assert por_placa["ABC1D23"].avaliacao.alerta.nivel == "proximo"  # faltam 800 km
        assert por_placa["ABC1D23"].avaliacao.saude == "atencao"
        assert por_placa["JKL4E56"].avaliacao.saude == "liberado"

    def test_busca_e_paginacao(self, sup_sp):
        itens, total = painel.listar_veiculos(sup_sp.client, busca="strada")
        assert total == 1 and itens[0].dados["modelo"] == "Strada"
        itens, total = painel.listar_veiculos(sup_sp.client, pagina=2, tamanho=2)
        assert total == 3 and len(itens) == 1
        # caracteres da sintaxe do PostgREST não quebram a busca
        assert painel.listar_veiculos(sup_sp.client, busca="a,b)(*%")[1] == 0

    def test_dashboard_global_agrupa_por_filial(self, admin):
        d = dashboard.carregar_dashboard(admin.client, None, agrupar_por_filial=True)
        assert len(d.veiculos) == 4 and d.custo_mes == 0
        por = {r.filial["uf"]: r for r in d.por_filial}
        assert (por["SP"].total, por["SP"].manutencao, por["SP"].atencao, por["SP"].liberado) == (3, 1, 1, 1)
        assert por["RJ"].total == 1
        assert d.requer_atencao[0].dados["placa"] == "XYZ9K88"  # manutenção vem antes de atenção
        assert [v.dados["placa"] for v in d.alertas_revisao] == ["XYZ9K88", "ABC1D23"]


# ----------------------------------------------------------------------------- motoristas
DADOS_MOTORISTA = {
    "nome": "Pedro Teste",
    "cpf": "123.456.789-09",
    "cnh": "22522791508",
    "email": "Pedro@X.com",
    "whatsapp": "(11) 98888-7777",
}


class TestMotoristas:
    def test_validacao_apontando_os_campos(self, sup_sp):
        with pytest.raises(ErroValidacao) as e:
            motoristas.salvar_motorista(
                sup_sp, {"nome": "P", "cpf": "111.111.111-11", "cnh": "123", "email": "x", "whatsapp": "1199"}
            )
        assert set(e.value.campos) == {"nome", "cpf", "cnh", "email", "whatsapp"}
        assert e.value.campos["cpf"] == "CPF inválido."

    def test_supervisor_cadastra_sempre_na_propria_filial(self, sup_sp, fake):
        motoristas.salvar_motorista(sup_sp, {**DADOS_MOTORISTA, "filial_id": fake.dados["rj"]["id"]})
        criado = next(m for m in fake.tables["motoristas"] if m["nome"] == "Pedro Teste")
        assert criado["filial_id"] == fake.dados["sp"]["id"]
        assert (criado["cpf"], criado["email"], criado["whatsapp"]) == ("12345678909", "pedro@x.com", "5511988887777")

    def test_admin_precisa_escolher_a_filial(self, admin, fake):
        with pytest.raises(ErroValidacao, match="Corrija"):
            motoristas.salvar_motorista(admin, DADOS_MOTORISTA)
        motoristas.salvar_motorista(admin, {**DADOS_MOTORISTA, "filial_id": fake.dados["rj"]["id"]})

    def test_cpf_duplicado_na_filial(self, sup_sp):
        motoristas.salvar_motorista(sup_sp, DADOS_MOTORISTA)
        with pytest.raises(ErroNegocio, match="CPF nesta filial"):
            motoristas.salvar_motorista(sup_sp, DADOS_MOTORISTA)

    def test_supervisor_nao_edita_nem_ve_motorista_de_outra_filial(self, sup_sp, fake):
        rj = fake.dados["m"][2]
        assert motoristas.obter_motorista(sup_sp.client, rj["id"]) is None
        with pytest.raises(ErroNegocio, match="não encontrado"):
            motoristas.salvar_motorista(sup_sp, {**DADOS_MOTORISTA, "status": "inativo"}, rj["id"])

    def test_listagem_busca_por_cpf_e_so_ativos(self, sup_sp, fake):
        itens, total = motoristas.listar_motoristas(sup_sp.client, busca="529.982")
        assert total == 1 and itens[0]["nome"] == "João da Silva" and itens[0]["filial"]["uf"] == "SP"
        fake.dados["m"][1]["status"] = "ferias"
        assert [m["nome"] for m in motoristas.listar_ativos(sup_sp.client)] == ["João da Silva"]

    def test_exclusao_so_admin_e_com_historico_bloqueia(self, admin, fake, sup_sp):
        m = fake.dados["m"][0]
        fake.tables["checklists"].append(
            {"id": "c1", "motorista_id": m["id"], "veiculo_id": "x", "filial_id": m["filial_id"]}
        )
        with pytest.raises(ErroNegocio, match="Inativo"):
            motoristas.excluir_motorista(admin, m["id"])
        motoristas.excluir_motorista(admin, fake.dados["m"][1]["id"])


# ----------------------------------------------------------------------------- veículos
DADOS_VEICULO = {
    "placa": "qwe-1r23",
    "marca": "Toyota",
    "modelo": "Hilux",
    "ano": "2023",
    "km_atual": "15000",
    "intervalo_revisao_km": "10000",
    "intervalo_revisao_dias": "180",
}


class TestVeiculos:
    def test_cria_com_plano_padrao_foto_e_documento(self, sup_sp, fake, jpeg_bytes):
        vid = veiculos.salvar_veiculo(
            sup_sp,
            {**DADOS_VEICULO, "filial_id": fake.dados["rj"]["id"]},
            foto=veiculos.Arquivo(jpeg_bytes, "image/jpeg"),
            documento=veiculos.Arquivo(b"%PDF-1.4 teste", "application/pdf"),
        )
        v = next(x for x in fake.tables["veiculos"] if x["id"] == vid)
        sp = fake.dados["sp"]["id"]
        assert v["filial_id"] == sp and v["placa"] == "QWE1R23"
        assert v["proxima_revisao_km"] == 25000
        assert date.fromisoformat(v["proxima_revisao_data"]) == hoje() + timedelta(days=180)
        assert v["foto_geral_url"] == f"{sp}/veiculos/{vid}/foto-geral.jpg"
        assert v["documento_url"] == f"{sp}/veiculos/{vid}/documento.pdf"
        assert f"veiculos/{v['foto_geral_url']}" in fake.storage and f"veiculos/{v['documento_url']}" in fake.storage
        assert fake.storage[f"veiculos/{v['documento_url']}"] == b"%PDF-1.4 teste"
        assert Image.open(io.BytesIO(fake.storage[f"veiculos/{v['foto_geral_url']}"])).format == "JPEG"

    def test_placa_duplicada_e_invalida(self, sup_sp):
        with pytest.raises(ErroNegocio, match="Já existe um veículo"):
            veiculos.salvar_veiculo(sup_sp, {**DADOS_VEICULO, "placa": "ABC1D23"})
        with pytest.raises(ErroValidacao) as e:
            veiculos.salvar_veiculo(sup_sp, {**DADOS_VEICULO, "placa": "123", "km_atual": "-5", "ano": "1900"})
        assert set(e.value.campos) == {"placa", "km_atual", "ano"}

    def test_arquivo_invalido_nao_cria_o_veiculo(self, sup_sp, fake):
        antes = len(fake.tables["veiculos"])
        with pytest.raises(ErroNegocio, match="ler a imagem"):
            veiculos.salvar_veiculo(sup_sp, DADOS_VEICULO, foto=veiculos.Arquivo(b"nao-e-imagem", "image/jpeg"))
        assert len(fake.tables["veiculos"]) == antes

    def test_edicao_mantem_filial_e_arquivos(self, sup_sp, fake, jpeg_bytes):
        v = fake.dados["v"][2]
        veiculos.salvar_veiculo(
            sup_sp,
            {**DADOS_VEICULO, "placa": v["placa"], "km_atual": "13000"},
            v["id"],
            foto=veiculos.Arquivo(jpeg_bytes, "image/png"),
        )
        assert v["km_atual"] == 13000 and v["filial_id"] == fake.dados["sp"]["id"]
        assert v["foto_geral_url"].endswith("foto-geral.jpg")
        veiculos.salvar_veiculo(sup_sp, {**DADOS_VEICULO, "placa": v["placa"]}, v["id"], remover_foto=True)
        assert v["foto_geral_url"] is None

    def test_supervisor_nao_edita_veiculo_de_outra_filial(self, sup_sp, fake):
        with pytest.raises(ErroNegocio, match="não encontrado"):
            veiculos.salvar_veiculo(sup_sp, DADOS_VEICULO, fake.dados["v"][3]["id"])

    def test_exclusao_admin_e_bloqueio_por_historico(self, admin, fake):
        v = fake.dados["v"][2]
        veiculos.excluir_veiculo(admin, v["id"])
        assert all(x["id"] != v["id"] for x in fake.tables["veiculos"])
        fake.tables["manutencoes"].append({"id": "m1", "veiculo_id": fake.dados["v"][0]["id"]})
        with pytest.raises(ErroNegocio, match="histórico"):
            veiculos.excluir_veiculo(admin, fake.dados["v"][0]["id"])


# ----------------------------------------------------------------------------- manutenções
def _manutencao(veiculo, **kw):
    return {
        "veiculo_id": veiculo["id"],
        "tipo": "preventiva",
        "descricao": "Troca de óleo e filtros",
        "custo": "1.234,56",
        "km_registro": veiculo["km_atual"] + 100,
        "data_manutencao": hoje().isoformat(),
        **kw,
    }


class TestManutencoes:
    def test_preventiva_agenda_a_proxima_revisao_e_avanca_o_km(self, sup_sp, fake):
        v = fake.dados["v"][1]  # XYZ9K88: revisão vencida
        manutencoes.registrar_manutencao(sup_sp, _manutencao(v, km_registro=90500))
        assert v["km_atual"] == 90500
        assert v["proxima_revisao_km"] == 100500
        assert date.fromisoformat(v["proxima_revisao_data"]) == hoje() + timedelta(days=180)
        m = fake.tables["manutencoes"][0]
        assert m["custo"] == 1234.56 and m["filial_id"] == v["filial_id"]
        painel_v = painel.obter_veiculo(sup_sp.client, v["id"])
        assert painel_v.avaliacao.alerta.nivel == "ok" and painel_v.avaliacao.saude == "liberado"

    def test_preventiva_retroativa_nao_volta_o_plano(self, sup_sp, fake):
        v = fake.dados["v"][2]
        manutencoes.registrar_manutencao(sup_sp, _manutencao(v, km_registro=12500))
        plano = (v["proxima_revisao_km"], v["proxima_revisao_data"])
        antiga = (hoje() - timedelta(days=60)).isoformat()
        manutencoes.registrar_manutencao(sup_sp, _manutencao(v, km_registro=11000, data_manutencao=antiga))
        assert (v["proxima_revisao_km"], v["proxima_revisao_data"]) == plano
        assert v["km_atual"] == 12500  # o KM nunca regride

    def test_status_alerta_persistido_so_na_ultima_preventiva(self, sup_sp, fake):
        v = fake.dados["v"][2]
        manutencoes.registrar_manutencao(
            sup_sp, _manutencao(v, km_registro=12000, data_manutencao=(hoje() - timedelta(days=30)).isoformat())
        )
        fake.tables["manutencoes"][0]["status_alerta"] = "vencido"  # simulação de estado antigo
        manutencoes.registrar_manutencao(sup_sp, _manutencao(v, km_registro=12200))
        antigas = [m for m in fake.tables["manutencoes"] if m["data_manutencao"] != hoje().isoformat()]
        assert antigas[0]["status_alerta"] == "ok"

    def test_corretiva_resolve_a_avaria_do_ultimo_checklist(self, sup_sp, fake):
        v = fake.dados["v"][2]
        fake.tables["checklists"].append(
            {
                "id": str(uuid.uuid4()),
                "veiculo_id": v["id"],
                "filial_id": v["filial_id"],
                "status": "critico",
                "data_envio": "2026-01-01T12:00:00+00:00",
            }
        )
        assert painel.obter_veiculo(sup_sp.client, v["id"]).avaliacao.saude == "manutencao"
        manutencoes.registrar_manutencao(
            sup_sp, _manutencao(v, tipo="corretiva", data_manutencao="2026-01-02", km_registro=12010)
        )
        assert painel.obter_veiculo(sup_sp.client, v["id"]).avaliacao.saude == "liberado"

    def test_validacoes(self, sup_sp, fake):
        v = fake.dados["v"][2]
        futuro = (hoje() + timedelta(days=3)).isoformat()
        with pytest.raises(ErroValidacao) as e:
            manutencoes.registrar_manutencao(sup_sp, _manutencao(v, descricao="a", custo="-1", data_manutencao=futuro))
        assert set(e.value.campos) == {"descricao", "custo", "data_manutencao"}

    def test_supervisor_nao_registra_em_veiculo_de_outra_filial(self, sup_sp, fake):
        with pytest.raises(ErroNegocio, match="Veículo não encontrado"):
            manutencoes.registrar_manutencao(sup_sp, _manutencao(fake.dados["v"][3]))

    def test_listagem_filtros_e_totais(self, sup_sp, fake):
        v = fake.dados["v"][2]
        manutencoes.registrar_manutencao(sup_sp, _manutencao(v, custo="100"))
        manutencoes.registrar_manutencao(sup_sp, _manutencao(v, tipo="corretiva", custo="50,5", km_registro=12300))
        todos = manutencoes.FiltroManutencao()
        itens, total = manutencoes.listar_manutencoes(sup_sp.client, todos)
        assert total == 2 and itens[0]["veiculo"]["placa"] == "JKL4E56"
        assert manutencoes.totais_de_custo(sup_sp.client, todos) == {
            "total": 150.5,
            "preventiva": 100.0,
            "corretiva": 50.5,
        }
        assert manutencoes.listar_manutencoes(sup_sp.client, manutencoes.FiltroManutencao(tipo="corretiva"))[1] == 1
        mes = hoje().strftime("%Y-%m")
        assert manutencoes.listar_manutencoes(sup_sp.client, manutencoes.FiltroManutencao(mes=mes))[1] == 2
        assert manutencoes.listar_manutencoes(sup_sp.client, manutencoes.FiltroManutencao(mes="2001-01"))[1] == 0

    def test_periodo(self):
        assert manutencoes.FiltroManutencao(mes="2026-12").periodo() == ("2026-12-01", "2027-01-01")
        assert manutencoes.FiltroManutencao(mes="2026-13").periodo() is None
        assert manutencoes.FiltroManutencao(mes="abc").periodo() is None


# ----------------------------------------------------------------------------- checklist
def _montar_checklist(sup, fake, jpeg_bytes, veiculo, motorista, severidades=None, km=None):
    cid = str(uuid.uuid4())
    severidades = severidades or {}
    itens = []
    for cat in CATEGORIAS:
        caminho, _ = checklists.enviar_foto_etapa(sup, veiculo["filial_id"], cid, cat, jpeg_bytes)
        sev = severidades.get(cat, "ok")
        itens.append(
            checklists.ItemChecklist(
                cat, caminho, sev, None if sev == "ok" else "detalhe", ({"x": 10.5, "y": 20.0},) if sev != "ok" else ()
            )
        )
    return checklists.EntradaChecklist(
        cid,
        veiculo["id"],
        motorista["id"],
        km if km is not None else veiculo["km_atual"] + 50,
        tuple(itens),
        " Tudo certo ",
    )


class TestChecklist:
    def test_fluxo_completo(self, sup_sp, fake, jpeg_bytes):
        v, m = fake.dados["v"][0], fake.dados["m"][0]
        entrada = _montar_checklist(sup_sp, fake, jpeg_bytes, v, m, {"rodas": "atencao", "motor": "critico"})
        # as 14 fotos subiram comprimidas para <filial>/<checklist>/<categoria>.jpg
        assert sum(k.startswith(f"checklists/{v['filial_id']}/{entrada.checklist_id}/") for k in fake.storage) == 14

        r = checklists.salvar_checklist(sup_sp, entrada)
        assert r.status == "critico"
        assert v["km_atual"] == 48250
        ck = checklists.obter_checklist(sup_sp.client, entrada.checklist_id)
        assert ck["status"] == "critico" and ck["observacoes_gerais"] == "Tudo certo"
        assert ck["supervisor_nome"] == "Carlos Supervisor" and ck["motorista"]["nome"] == "João da Silva"
        assert [e.categoria for e, _ in ck["fotos"]] == list(CATEGORIAS)
        por_cat = {e.categoria: f for e, f in ck["fotos"]}
        assert por_cat["motor"]["severidade"] == "critico" and por_cat["motor"]["marcadores"] == [
            {"x": 10.5, "y": 20.0}
        ]
        assert por_cat["frente"]["url"].startswith("http")
        assert painel.obter_veiculo(sup_sp.client, v["id"]).avaliacao.saude == "manutencao"

    def test_reenvio_e_idempotente(self, sup_sp, fake, jpeg_bytes):
        entrada = _montar_checklist(sup_sp, fake, jpeg_bytes, fake.dados["v"][0], fake.dados["m"][0])
        checklists.salvar_checklist(sup_sp, entrada)
        assert checklists.salvar_checklist(sup_sp, entrada).status == "ok"
        assert len(fake.tables["checklists"]) == 1

    def test_foto_ausente_no_storage(self, sup_sp, fake, jpeg_bytes):
        v = fake.dados["v"][0]
        entrada = _montar_checklist(sup_sp, fake, jpeg_bytes, v, fake.dados["m"][0])
        del fake.storage[f"checklists/{caminho_foto(v['filial_id'], entrada.checklist_id, 'motor')}"]
        with pytest.raises(ErroNegocio, match='etapa "Motor"'):
            checklists.salvar_checklist(sup_sp, entrada)
        assert not fake.tables["checklists"]

    def test_regras_de_validacao(self, sup_sp, fake, jpeg_bytes):
        v, m = fake.dados["v"][0], fake.dados["m"][0]
        base = _montar_checklist(sup_sp, fake, jpeg_bytes, v, m)

        with pytest.raises(ErroNegocio, match="14 fotos"):
            checklists.salvar_checklist(
                sup_sp, checklists.EntradaChecklist(**{**base.__dict__, "itens": base.itens[:13]})
            )
        sem_obs = [
            checklists.ItemChecklist(i.categoria, i.foto_path, "atencao" if i.categoria == "frente" else "ok")
            for i in base.itens
        ]
        with pytest.raises(ErroNegocio, match="Descreva a inconformidade"):
            checklists.salvar_checklist(
                sup_sp, checklists.EntradaChecklist(**{**base.__dict__, "itens": tuple(sem_obs)})
            )
        with pytest.raises(ErroNegocio, match="KM informado é menor"):
            checklists.salvar_checklist(sup_sp, checklists.EntradaChecklist(**{**base.__dict__, "km_atual": 10}))
        fora = [
            checklists.ItemChecklist(i.categoria, "outra/pasta/x.jpg", "ok") if i.categoria == "frente" else i
            for i in base.itens
        ]
        with pytest.raises(ErroNegocio, match="Caminho de foto inválido"):
            checklists.salvar_checklist(sup_sp, checklists.EntradaChecklist(**{**base.__dict__, "itens": tuple(fora)}))
        marcador_ruim = [
            checklists.ItemChecklist(i.categoria, i.foto_path, "ok", None, ({"x": 150, "y": 1},))
            if i.categoria == "frente"
            else i
            for i in base.itens
        ]
        with pytest.raises(ErroNegocio, match="Marcadores"):
            checklists.salvar_checklist(
                sup_sp, checklists.EntradaChecklist(**{**base.__dict__, "itens": tuple(marcador_ruim)})
            )

    def test_motorista_inativo_ou_de_outra_filial(self, sup_sp, admin, fake, jpeg_bytes):
        v = fake.dados["v"][0]
        entrada = _montar_checklist(sup_sp, fake, jpeg_bytes, v, fake.dados["m"][0])
        fake.dados["m"][0]["status"] = "inativo"
        with pytest.raises(ErroNegocio, match="não está ativo"):
            checklists.salvar_checklist(sup_sp, entrada)
        fake.dados["m"][0]["status"] = "ativo"
        # admin tenta usar motorista do RJ em veículo de SP
        cruzado = checklists.EntradaChecklist(**{**entrada.__dict__, "motorista_id": fake.dados["m"][2]["id"]})
        with pytest.raises(ErroNegocio, match="filiais diferentes"):
            checklists.salvar_checklist(admin, cruzado)

    def test_supervisor_de_outra_filial_nao_ve_nem_envia(self, sup_sp, sup_rj, fake, jpeg_bytes):
        v, m = fake.dados["v"][0], fake.dados["m"][0]
        entrada = _montar_checklist(sup_sp, fake, jpeg_bytes, v, m)
        checklists.salvar_checklist(sup_sp, entrada)
        assert checklists.obter_checklist(sup_rj.client, entrada.checklist_id) is None
        assert checklists.listar_checklists(sup_rj.client)[1] == 0
        with pytest.raises(ErroNegocio, match="Veículo não encontrado"):
            checklists.salvar_checklist(sup_rj, entrada)
        with pytest.raises(ErroNegocio, match=r"permissão|Falha"):  # upload na pasta de outra filial
            checklists.enviar_foto_etapa(sup_rj, v["filial_id"], entrada.checklist_id, "frente", jpeg_bytes)

    def test_listagem_filtra_status_e_exclusao_remove_as_fotos(self, sup_sp, admin, fake, jpeg_bytes):
        v, m = fake.dados["v"][0], fake.dados["m"][0]
        e1 = _montar_checklist(sup_sp, fake, jpeg_bytes, v, m)
        e2 = _montar_checklist(sup_sp, fake, jpeg_bytes, v, m, {"luzes_sinalizacao": "atencao"})
        checklists.salvar_checklist(sup_sp, e1)
        checklists.salvar_checklist(sup_sp, e2)
        assert checklists.listar_checklists(sup_sp.client)[1] == 2
        itens, total = checklists.listar_checklists(sup_sp.client, status="atencao")
        assert total == 1 and itens[0]["veiculo"]["placa"] == "ABC1D23"

        with pytest.raises(ErroNegocio, match="permissão"):
            checklists.excluir_checklist(sup_sp, e1.checklist_id)
        checklists.excluir_checklist(admin, e1.checklist_id)
        assert not any(e1.checklist_id in k for k in fake.storage)
        assert checklists.obter_checklist(admin.client, e1.checklist_id) is None

    def test_foto_invalida_nao_sobe(self, sup_sp, fake):
        with pytest.raises(ErroNegocio, match="ler a imagem"):
            checklists.enviar_foto_etapa(sup_sp, fake.dados["sp"]["id"], str(uuid.uuid4()), "frente", b"lixo")
        with pytest.raises(ErroNegocio, match="Etapa inválida"):
            checklists.enviar_foto_etapa(sup_sp, fake.dados["sp"]["id"], str(uuid.uuid4()), "teto", b"x")


# ----------------------------------------------------------------------------- rascunhos / alertas / admin
class TestRascunhos:
    def test_ciclo_e_isolamento(self, sup_sp, sup_rj):
        assert rascunhos.carregar_rascunho(sup_sp.client, sup_sp.user_id) is None
        rascunhos.salvar_rascunho(sup_sp.client, sup_sp.user_id, {"passo": 3})
        rascunhos.salvar_rascunho(sup_sp.client, sup_sp.user_id, {"passo": 5})  # upsert
        assert rascunhos.carregar_rascunho(sup_sp.client, sup_sp.user_id) == {"passo": 5}
        assert rascunhos.carregar_rascunho(sup_rj.client, sup_rj.user_id) is None
        assert rascunhos.carregar_rascunho(sup_rj.client, sup_sp.user_id) is None  # não lê o dos outros
        rascunhos.apagar_rascunho(sup_sp.client, sup_sp.user_id)
        assert rascunhos.carregar_rascunho(sup_sp.client, sup_sp.user_id) is None


class TestAlertasSync:
    def test_cron_com_cliente_admin_persiste_status(self, fake, sup_sp):
        v = fake.dados["v"][1]  # revisão vencida
        manutencoes.registrar_manutencao(
            sup_sp,
            _manutencao(v, km_registro=89500, data_manutencao=(hoje() - timedelta(days=170)).isoformat(), custo="10"),
        )
        # após a preventiva: próxima = 99.500 km e +180d (hoje-170 => faltam 10 dias => próximo)
        r = alertas.sincronizar_alertas(cliente_admin())
        assert r.veiculos == 4
        assert fake.tables["manutencoes"][0]["status_alerta"] == "proximo"
        assert alertas.sincronizar_alertas(cliente_admin()).atualizados == 0  # idempotente


class TestAdmin:
    def test_filiais_crud_e_restricao(self, admin, fake):
        filiais.salvar_filial(admin, {"nome_cidade": "Curitiba", "uf": "pr"})
        assert any(f["uf"] == "PR" for f in filiais.listar_filiais(admin.client))
        with pytest.raises(ErroNegocio, match="já está cadastrada"):
            filiais.salvar_filial(admin, {"nome_cidade": "Curitiba", "uf": "PR"})
        with pytest.raises(ErroValidacao):
            filiais.salvar_filial(admin, {"nome_cidade": "X", "uf": "PRR"})
        with pytest.raises(ErroNegocio, match="vinculados"):
            filiais.excluir_filial(admin, fake.dados["sp"]["id"])
        curitiba = next(f for f in fake.tables["filiais"] if f["uf"] == "PR")
        filiais.excluir_filial(admin, curitiba["id"])

    def test_supervisor_ve_so_a_propria_filial(self, sup_sp, fake):
        assert [f["uf"] for f in filiais.listar_filiais(sup_sp.client)] == ["SP"]

    def test_criar_e_excluir_supervisor(self, admin, config, fake):
        dados = {
            "nome": "Novo Sup",
            "email": "Novo@Sup.com",
            "senha": "segredo123",
            "filial_id": fake.dados["rj"]["id"],
        }
        uid = supervisores.criar_supervisor(admin, dados)
        novo = auth.entrar(config, "novo@sup.com", "segredo123")  # consegue logar e fica preso à filial
        assert novo.user_id == uid and novo.filial_id == fake.dados["rj"]["id"] and not novo.is_admin
        with pytest.raises(ErroNegocio, match="Já existe um usuário"):
            supervisores.criar_supervisor(admin, dados)
        with pytest.raises(ErroValidacao):
            supervisores.criar_supervisor(admin, {**dados, "senha": "123"})
        emails = {u["email"] for u in supervisores.listar_usuarios(admin)}
        assert "novo@sup.com" in emails
        with pytest.raises(ErroNegocio, match="próprio usuário"):
            supervisores.excluir_supervisor(admin, admin.user_id)
        supervisores.excluir_supervisor(admin, uid)
        with pytest.raises(ErroNegocio, match="inválidos"):
            auth.entrar(config, "novo@sup.com", "segredo123")

    def test_supervisor_com_checklists_nao_e_excluido(self, admin, sup_sp, fake, jpeg_bytes):
        checklists.salvar_checklist(
            sup_sp, _montar_checklist(sup_sp, fake, jpeg_bytes, fake.dados["v"][0], fake.dados["m"][0])
        )
        with pytest.raises(ErroNegocio, match="histórico"):
            supervisores.excluir_supervisor(admin, sup_sp.user_id)
        assert cliente_admin().auth.admin  # cliente admin disponível


def test_urls_assinadas_ignoram_arquivos_inexistentes(sup_sp, fake, jpeg_bytes):
    cid = str(uuid.uuid4())
    caminho, _ = checklists.enviar_foto_etapa(sup_sp, fake.dados["sp"]["id"], cid, "frente", jpeg_bytes)
    urls = storage.urls_assinadas(sup_sp.client, storage.BUCKET_CHECKLISTS, [caminho, "nao/existe.jpg", None])
    assert list(urls) == [caminho]
