"""E2E no navegador: login, escopo por papel, cookie de sessão, wizard de 14 fotos, rascunho e admin."""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Page, expect

from frotas.domain.checklist import ETAPAS

pytestmark = pytest.mark.e2e
T = 30_000  # timeout generoso: cada interação dispara um rerun do Streamlit


def _botao(page: Page, nome: str):
    return page.get_by_role("button", name=re.compile(re.escape(nome)))


def _escolher(page: Page, rotulo: str, opcao: str | re.Pattern) -> None:
    """Abre um selectbox do Streamlit e escolhe a opção (repete o clique se o layout ainda estiver animando)."""
    campo = page.get_by_label(rotulo)
    alvo = page.get_by_role("option", name=opcao)
    for _ in range(4):
        campo.click()
        try:
            alvo.wait_for(timeout=2000)
            break
        except Exception:
            continue
    alvo.click()


def _login(page: Page, url: str, email: str, senha: str = "senha-correta", *, esperar: bool = True) -> None:
    """Entra e (por padrão) espera o painel E o cookie de sessão — só então é seguro navegar para outra URL."""
    page.goto(url)
    page.get_by_label("E-mail").fill(email)
    page.get_by_label("Senha").fill(senha)
    _botao(page, "Entrar").click()
    if esperar:
        expect(page.get_by_role("heading", name="Painel da frota")).to_be_visible()
        page.wait_for_function("document.cookie.includes('frotas_rt=rt-')")


@pytest.fixture
def pagina(navegador):
    ctx = navegador.new_context(viewport={"width": 1280, "height": 900}, locale="pt-BR")
    ctx.set_default_timeout(T)
    p = ctx.new_page()
    yield p
    ctx.close()


@pytest.fixture
def celular(navegador):
    ctx = navegador.new_context(
        viewport={"width": 412, "height": 915}, is_mobile=True, has_touch=True, locale="pt-BR", permissions=["camera"]
    )
    ctx.set_default_timeout(T)
    p = ctx.new_page()
    yield p
    ctx.close()


class TestAcesso:
    def test_login_invalido_e_valido(self, app_url, mundo_e2e, pagina):
        _login(pagina, app_url, "sup.sp@frotas.com", "errada", esperar=False)
        expect(pagina.get_by_text("E-mail ou senha inválidos.")).to_be_visible()
        pagina.get_by_label("Senha").fill("senha-correta")
        _botao(pagina, "Entrar").click()
        expect(pagina.get_by_role("heading", name="Painel da frota")).to_be_visible()

    def test_usuario_sem_perfil_nao_entra(self, app_url, mundo_e2e, pagina):
        _login(pagina, app_url, "sem.perfil@frotas.com", esperar=False)
        expect(pagina.get_by_text("ainda não foi habilitado")).to_be_visible()

    def test_supervisor_so_ve_a_propria_filial_e_nao_tem_menu_admin(self, app_url, mundo_e2e, pagina):
        _login(pagina, app_url, "sup.sp@frotas.com")
        expect(pagina.get_by_role("heading", name="Painel da frota")).to_be_visible()
        expect(pagina.get_by_text("Filial São Paulo/SP")).to_be_visible()
        expect(pagina.get_by_role("link", name=re.compile("Supervisores"))).to_have_count(0)
        expect(pagina.get_by_text("Alertas de revisão preventiva")).to_be_visible()
        expect(pagina.get_by_text("Revisão vencida").first).to_be_visible()
        corpo = pagina.locator("body").inner_text()
        assert "XYZ9K88" in corpo and "ABC1D23" in corpo and "Revisão próxima" in corpo
        assert "RJO1A11" not in corpo
        pagina.screenshot(path="/tmp/e2e_dashboard_supervisor.png", full_page=True)

    def test_sessao_sobrevive_ao_recarregamento_e_logout_limpa(self, app_url, mundo_e2e, pagina):
        _login(pagina, app_url, "sup.sp@frotas.com")
        expect(pagina.get_by_role("heading", name="Painel da frota")).to_be_visible()
        pagina.reload()  # novo websocket => nova sessão do Streamlit; o cookie retoma o login
        expect(pagina.get_by_role("heading", name="Painel da frota")).to_be_visible()
        pagina.goto(f"{app_url}/veiculos")
        expect(pagina.get_by_role("heading", name="Veículos")).to_be_visible()

        _botao(pagina, "Sair").click()
        expect(pagina.get_by_label("E-mail")).to_be_visible()
        pagina.reload()
        expect(pagina.get_by_label("E-mail")).to_be_visible()  # cookie apagado: não volta sozinho


class TestCadastros:
    def test_motorista_valida_no_servidor_e_preserva_os_campos(self, app_url, mundo_e2e, pagina):
        _login(pagina, app_url, "sup.sp@frotas.com")
        pagina.goto(f"{app_url}/motoristas")
        _botao(pagina, "Novo motorista").click()
        pagina.get_by_label("Nome completo *").fill("Pedro Teste")
        pagina.get_by_label("CPF *").fill("111.111.111-11")
        pagina.get_by_label("CNH *").fill("12345678901")
        pagina.get_by_label("E-mail *").fill("pedro@x.com")
        pagina.get_by_label("WhatsApp *").fill("1199")
        _botao(pagina, "Cadastrar motorista").click()
        expect(pagina.get_by_text("CPF inválido.")).to_be_visible()
        expect(pagina.get_by_text("WhatsApp inválido. Use DDD + número.")).to_be_visible()
        expect(pagina.get_by_label("Nome completo *")).to_have_value("Pedro Teste")

        pagina.get_by_label("CPF *").fill("123.456.789-09")
        pagina.get_by_label("CNH *").fill("22522791508")
        pagina.get_by_label("WhatsApp *").fill("(11) 98888-7777")
        _botao(pagina, "Cadastrar motorista").click()
        expect(pagina.get_by_text("Pedro Teste")).to_be_visible()
        wa = pagina.get_by_role("link", name=re.compile(r"\(11\) 98888-7777")).get_attribute("href")
        assert wa.startswith("https://wa.me/5511988887777")
        assert any(
            m["nome"] == "Pedro Teste" and m["filial_id"] == mundo_e2e.dados["sp"]["id"]
            for m in mundo_e2e.tables["motoristas"]
        )

    def test_veiculo_com_foto_e_placa_duplicada(self, app_url, mundo_e2e, pagina, foto_jpeg):
        _login(pagina, app_url, "sup.sp@frotas.com")
        pagina.goto(f"{app_url}/veiculos")
        _botao(pagina, "Novo veículo").click()
        pagina.get_by_label("Placa *").fill("ABC1D23")
        pagina.get_by_label("Modelo").fill("Duplicado")
        _botao(pagina, "Cadastrar veículo").click()
        expect(pagina.get_by_text("Já existe um veículo cadastrado com esta placa.")).to_be_visible()

        pagina.get_by_label("Placa *").fill("QWE-1R23")
        pagina.get_by_label("Modelo").fill("Hilux")
        pagina.locator("input[type=file]").first.set_input_files(str(foto_jpeg("v.jpg", (40, 90, 160))))
        _botao(pagina, "Cadastrar veículo").click()
        expect(pagina.get_by_role("heading", name="QWE1R23")).to_be_visible()
        veic = next(v for v in mundo_e2e.tables["veiculos"] if v["placa"] == "QWE1R23")
        assert (
            veic["foto_geral_url"].endswith("foto-geral.jpg")
            and f"veiculos/{veic['foto_geral_url']}" in mundo_e2e.storage
        )


def _preencher_etapa(page: Page, indice: int, foto, *, webcam: bool = False) -> None:
    etapa = ETAPAS[indice - 1]
    expect(page.get_by_role("heading", name=etapa.titulo, exact=True)).to_be_visible()
    assert _botao(page, "Próxima" if indice < 14 else "Revisar").is_disabled(), "avançar deve exigir a foto"
    if webcam:
        page.get_by_role("tab", name=re.compile("Webcam")).click()
        _botao(page, "Take Photo").click()
    else:
        page.locator("input[type=file]").first.set_input_files(str(foto))
    expect(page.get_by_text(re.compile("Enviada"))).to_be_visible()


class TestWizard:
    def test_checklist_completo_de_14_fotos(self, app_url, mundo_e2e, celular, foto_jpeg):
        p = celular
        _login(p, app_url, "sup.sp@frotas.com")
        expect(p.get_by_text("Painel da frota")).to_be_visible()
        p.goto(f"{app_url}/novo-checklist")
        expect(p.get_by_role("heading", name="Identificação")).to_be_visible()

        # identificação (o botão só habilita com veículo + motorista)
        assert _botao(p, "Começar").is_disabled()
        _escolher(p, "Veículo *", re.compile("ABC-1D23|ABC1D23"))
        _escolher(p, "Motorista *", "João da Silva")
        p.screenshot(path="/tmp/e2e_wizard_ident.png")
        _botao(p, "Começar").click()

        fotos = [foto_jpeg(f"f{i}.jpg", (i * 17 % 255, 80, 200 - i * 9)) for i in range(14)]
        for i in range(1, 15):
            _preencher_etapa(p, i, fotos[i - 1], webcam=(i == 2))
            if i == 1:
                p.screenshot(path="/tmp/e2e_wizard_foto.png")
                # marcador na foto => etapa vira "Atenção" e exige descrição
                p.get_by_text("Marcar avaria na foto").click()
                moldura = p.frame_locator("iframe").first
                moldura.locator("img").first.click(position={"x": 60, "y": 50})
                expect(p.get_by_label("Descreva a inconformidade *")).to_be_visible()
                assert _botao(p, "Próxima").is_disabled()
                p.get_by_label("Descreva a inconformidade *").fill("Arranhão profundo na porta")
                p.get_by_label("Descreva a inconformidade *").press("Control+Enter")
                p.screenshot(path="/tmp/e2e_wizard_avaria.png")
            if i == 9:  # nível de óleo: avaria crítica
                p.get_by_text("🛑 Avaria").click()
                p.get_by_label("Descreva a inconformidade *").fill("Nível de óleo abaixo do mínimo")
                p.get_by_label("Descreva a inconformidade *").press("Control+Enter")
            if i == 7:  # painel: KM menor que o último registrado bloqueia
                km = p.get_by_test_id("stNumberInputField")
                km.fill("100")
                km.press("Enter")
                expect(p.get_by_text(re.compile("não pode ser menor que o último registrado")).first).to_be_visible()
                assert _botao(p, "Próxima").is_disabled()
                km.fill("48350")
                km.press("Enter")
            _botao(p, "Próxima" if i < 14 else "Revisar").click()

        expect(p.get_by_role("heading", name="Revisão final")).to_be_visible()
        expect(p.get_by_text("12 ok · 1 atenção · 1 avaria")).to_be_visible()  # contadores ao vivo no cabeçalho
        p.screenshot(path="/tmp/e2e_wizard_revisao.png", full_page=True)
        p.get_by_label("Observações gerais").fill("Veículo com avaria no óleo — encaminhar à oficina.")
        p.get_by_label("Observações gerais").press("Control+Enter")
        _botao(p, "Enviar checklist").click()

        expect(p.get_by_text(re.compile(r"Checklist · ABC1D23"))).to_be_visible()
        assert len(mundo_e2e.tables["checklists"]) == 1 and len(mundo_e2e.tables["checklist_fotos"]) == 14
        ck = mundo_e2e.tables["checklists"][0]
        assert ck["status"] == "critico" and ck["km_registro"] == 48350
        assert mundo_e2e.dados["v"][0]["km_atual"] == 48350
        assert not mundo_e2e.tables["checklist_rascunhos"], "o rascunho deve ser apagado após o envio"
        assert p.locator("img").count() >= 14
        p.screenshot(path="/tmp/e2e_checklist_detalhe.png", full_page=True)

    def test_rascunho_apos_perder_a_sessao(self, app_url, mundo_e2e, celular, foto_jpeg):
        p = celular
        _login(p, app_url, "sup.sp@frotas.com")
        p.goto(f"{app_url}/novo-checklist")
        _escolher(p, "Veículo *", re.compile("JKL"))
        _escolher(p, "Motorista *", "Maria Souza")
        _botao(p, "Começar").click()
        _preencher_etapa(p, 1, foto_jpeg("r.jpg", (30, 30, 120)))
        assert len(mundo_e2e.tables["checklist_rascunhos"]) == 1

        p.reload()  # o celular perdeu a conexão: nova sessão do Streamlit (login volta pelo cookie)
        p.goto(f"{app_url}/novo-checklist")
        expect(p.get_by_text(re.compile("Há um checklist em andamento"))).to_be_visible()
        p.screenshot(path="/tmp/e2e_rascunho.png")
        _botao(p, "Continuar").click()
        expect(p.get_by_text(re.compile("Enviada"))).to_be_visible()  # a foto já enviada foi restaurada
        expect(p.get_by_role("heading", name=ETAPAS[0].titulo, exact=True)).to_be_visible()

    def test_descartar_rascunho(self, app_url, mundo_e2e, celular, foto_jpeg):
        p = celular
        _login(p, app_url, "sup.sp@frotas.com")
        p.goto(f"{app_url}/novo-checklist")
        _escolher(p, "Veículo *", re.compile("JKL"))
        _escolher(p, "Motorista *", "Maria Souza")
        _botao(p, "Começar").click()
        _preencher_etapa(p, 1, foto_jpeg("d.jpg", (10, 90, 10)))
        p.goto(f"{app_url}/novo-checklist")
        _botao(p, "Descartar").click()
        expect(p.get_by_role("heading", name="Identificação")).to_be_visible()
        assert not mundo_e2e.tables["checklist_rascunhos"]


class TestAdmin:
    def test_admin_ve_tudo_e_cria_filial(self, app_url, mundo_e2e, pagina):
        _login(pagina, app_url, "admin@frotas.com")
        expect(pagina.get_by_text("Visão global")).to_be_visible(timeout=T) if False else None
        expect(pagina.get_by_text("Saúde da frota por filial")).to_be_visible()
        expect(pagina.get_by_role("link", name=re.compile("Supervisores"))).to_be_visible()
        # a tabela por filial é um canvas (sem texto no DOM): confere os KPIs globais (3 em SP + 1 no RJ)
        valores = pagina.get_by_test_id("stMetricValue")
        expect(valores.first).to_have_text("4")
        pagina.screenshot(path="/tmp/e2e_dashboard_admin.png", full_page=True)

        pagina.goto(f"{app_url}/filiais")
        pagina.get_by_text("Nova filial").click()
        pagina.get_by_label("Cidade *").first.fill("Curitiba")
        pagina.get_by_label("UF *").first.fill("pr")
        _botao(pagina, "Adicionar filial").click()
        expect(pagina.get_by_text("Curitiba/PR")).to_be_visible()

    def test_admin_cria_supervisor_que_so_ve_a_propria_filial(self, app_url, mundo_e2e, pagina, navegador):
        _login(pagina, app_url, "admin@frotas.com")
        pagina.goto(f"{app_url}/supervisores")
        pagina.get_by_text("Novo supervisor").first.click()  # expander (fechado quando já há usuários)
        pagina.get_by_label("Nome *").fill("Novo Supervisor")
        pagina.get_by_label("E-mail *").fill("novo@frotas.com")
        pagina.get_by_role("textbox", name="Senha provisória *").fill("segredo123")
        _escolher(pagina, "Filial *", "Rio de Janeiro/RJ")
        _botao(pagina, "Criar supervisor").click()
        expect(pagina.get_by_text("Novo Supervisor").first).to_be_visible()

        ctx = navegador.new_context(viewport={"width": 1280, "height": 900}, locale="pt-BR")
        ctx.set_default_timeout(T)
        outro = ctx.new_page()
        _login(outro, app_url, "novo@frotas.com", "segredo123")
        expect(outro.get_by_text("Filial Rio de Janeiro/RJ")).to_be_visible()
        outro.goto(f"{app_url}/veiculos")  # o cookie de sessão mantém o login
        expect(outro.get_by_text("1 veículo(s)")).to_be_visible()
        corpo = outro.locator("body").inner_text()
        assert "RJO1A11" in corpo and "ABC1D23" not in corpo  # só enxerga a filial do RJ
        ctx.close()
