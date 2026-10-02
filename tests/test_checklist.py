from frotas.domain.checklist import (
    CATEGORIAS,
    ETAPAS,
    TOTAL_ETAPAS,
    caminho_foto,
    contar_severidades,
    status_geral,
)


def test_sao_14_etapas_unicas():
    assert TOTAL_ETAPAS == 14
    assert len(set(CATEGORIAS)) == 14
    assert ETAPAS[0].titulo == "Lateral direita"


def test_pior_severidade_define_o_status():
    assert status_geral([]) == "ok"
    assert status_geral(["ok", "ok"]) == "ok"
    assert status_geral(["ok", "atencao"]) == "atencao"
    assert status_geral(["atencao", "critico", "ok"]) == "critico"


def test_contagem_e_caminho():
    assert contar_severidades(["ok", "atencao", "ok", "critico"]) == {"ok": 2, "atencao": 1, "critico": 1}
    assert caminho_foto("f1", "c1", "motor") == "f1/c1/motor.jpg"
