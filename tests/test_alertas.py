from datetime import date

from frotas.domain.alertas import (
    avaliar_saude_veiculo,
    avaliar_veiculo_painel,
    calcular_alerta_revisao,
    descrever_alerta,
    proxima_revisao,
)

HOJE = date(2026, 3, 10)


def alerta(km_atual=50_000, prox_km=60_000, prox_data="2026-09-01"):
    return calcular_alerta_revisao(km_atual, prox_km, prox_data, HOJE)


class TestAlertaRevisao:
    def test_ok_quando_folgado(self):
        r = alerta()
        assert (r.nivel, r.motivos, r.km_restantes, r.dias_restantes) == ("ok", (), 10_000, 175)

    def test_proximo_por_km(self):
        r = alerta(km_atual=59_000)
        assert r.nivel == "proximo" and r.motivos == ("km",)

    def test_vencido_por_km(self):
        assert alerta(km_atual=60_000).nivel == "vencido"
        r = alerta(km_atual=61_500)
        assert r.nivel == "vencido" and r.km_restantes == -1500

    def test_proximo_por_periodo(self):
        r = alerta(prox_data="2026-03-25")
        assert (r.nivel, r.motivos, r.dias_restantes) == ("proximo", ("periodo",), 15)

    def test_vencido_por_periodo(self):
        assert alerta(prox_data="2026-03-10").nivel == "vencido"
        assert alerta(prox_data="2026-02-01").nivel == "vencido"

    def test_vale_o_pior_e_lista_ambos_motivos(self):
        r = alerta(km_atual=59_500, prox_data="2026-03-01")
        assert r.nivel == "vencido" and r.motivos == ("km", "periodo")

    def test_sem_plano(self):
        r = calcular_alerta_revisao(1, None, None, HOJE)
        assert (r.nivel, r.motivos, r.km_restantes, r.dias_restantes) == ("ok", (), None, None)


def test_proxima_revisao_soma_intervalos():
    assert proxima_revisao(52_300, "2026-01-31", 10_000, 30) == (62_300, date(2026, 3, 2))


class TestSaude:
    def saude(self, **kw):
        base = dict(ultimo_checklist_status=None, ultimo_checklist_em=None, ultima_corretiva_em=None, alerta="ok")
        return avaliar_saude_veiculo(**{**base, **kw})

    def test_liberado_sem_pendencias(self):
        assert self.saude().saude == "liberado"
        assert self.saude(ultimo_checklist_status="ok", ultimo_checklist_em="2026-03-01T12:00:00Z").saude == "liberado"

    def test_critico_e_atencao(self):
        em = "2026-03-01T12:00:00Z"
        assert self.saude(ultimo_checklist_status="critico", ultimo_checklist_em=em).saude == "manutencao"
        assert self.saude(ultimo_checklist_status="atencao", ultimo_checklist_em=em).saude == "atencao"

    def test_corretiva_posterior_resolve(self):
        base = dict(ultimo_checklist_status="critico", ultimo_checklist_em="2026-03-05T15:00:00Z")
        assert self.saude(**base, ultima_corretiva_em="2026-03-05").saude == "liberado"
        assert self.saude(**base, ultima_corretiva_em="2026-03-08").saude == "liberado"
        assert self.saude(**base, ultima_corretiva_em="2026-03-04").saude == "manutencao"

    def test_usa_fuso_de_sao_paulo(self):
        # 02:00Z de 06/03 ainda é 05/03 (23h) no Brasil
        r = self.saude(
            ultimo_checklist_status="critico",
            ultimo_checklist_em="2026-03-06T02:00:00Z",
            ultima_corretiva_em="2026-03-05",
        )
        assert r.saude == "liberado"

    def test_revisao_vencida_e_proxima(self):
        assert self.saude(alerta="vencido").saude == "manutencao"
        assert self.saude(alerta="proximo").saude == "atencao"
        r = self.saude(alerta="proximo", ultimo_checklist_status="critico", ultimo_checklist_em="2026-03-01T12:00:00Z")
        assert r.saude == "manutencao" and len(r.motivos) == 2


def test_avaliar_veiculo_painel_e_descricao():
    v = {
        "km_atual": 90_000,
        "proxima_revisao_km": 89_000,
        "proxima_revisao_data": "2027-03-01",
        "ultimo_checklist_status": "critico",
        "ultimo_checklist_em": "2026-09-20T12:00:00Z",
        "ultima_corretiva_em": None,
    }
    a = avaliar_veiculo_painel(v, HOJE)
    assert a.saude == "manutencao" and a.alerta.nivel == "vencido"
    assert descrever_alerta(a.alerta) == "Excedeu 1.000 km"
    assert descrever_alerta(alerta(km_atual=59_350, prox_data="2026-03-18")) == "Faltam 650 km · Vence em 8 dias"
    assert descrever_alerta(calcular_alerta_revisao(1, None, None, HOJE)) == "Sem plano de revisão"
