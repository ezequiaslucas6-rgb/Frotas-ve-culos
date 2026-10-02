from frotas.domain.formatos import brl, data_br, data_hora_br, km, numero, veiculo_label


def test_numeros_pt_br():
    assert numero(48200) == "48.200"
    assert km(1234567) == "1.234.567 km"
    assert brl(0) == "R$ 0,00"
    assert brl(1234.5) == "R$ 1.234,50"
    assert brl(1234567.891) == "R$ 1.234.567,89"


def test_datas():
    assert data_br("2026-03-10") == "10/03/2026"
    assert data_br(None) == "—"
    # 02:00Z = 23:00 do dia anterior em São Paulo (UTC-3)
    assert data_hora_br("2026-03-06T02:00:00+00:00") == "05/03/2026 23:00"


def test_veiculo_label():
    assert veiculo_label({"placa": "abc1234", "marca": "Fiat", "modelo": "Strada"}) == "ABC-1234 · Fiat Strada"
    assert veiculo_label({"placa": "ABC1D23", "marca": None, "modelo": None}) == "ABC1D23"
