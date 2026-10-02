import pytest

from frotas.domain.documentos import (
    cnh_valida,
    cpf_valido,
    formatar_cpf,
    formatar_placa,
    formatar_whatsapp,
    link_whatsapp,
    normalizar_placa,
    normalizar_whatsapp,
    placa_valida,
)


class TestCpf:
    @pytest.mark.parametrize("cpf", ["529.982.247-25", "11144477735"])
    def test_aceita_validos(self, cpf):
        assert cpf_valido(cpf)

    @pytest.mark.parametrize("cpf", ["529.982.247-24", "1234567890", "111.111.111-11", "", None])
    def test_rejeita_invalidos(self, cpf):
        assert not cpf_valido(cpf)


class TestCnh:
    def test_aceita_valida(self):
        assert cnh_valida("22522791508")

    @pytest.mark.parametrize("cnh", ["22522791509", "2252279150", "00000000000", None])
    def test_rejeita_invalidas(self, cnh):
        assert not cnh_valida(cnh)


class TestPlaca:
    @pytest.mark.parametrize("placa", ["ABC-1234", "abc1d23", "ABC1234"])
    def test_aceita_antiga_e_mercosul(self, placa):
        assert placa_valida(placa)

    @pytest.mark.parametrize("placa", ["AB12345", "ABCD123", "", None])
    def test_rejeita_invalidas(self, placa):
        assert not placa_valida(placa)

    def test_normaliza_e_formata(self):
        assert normalizar_placa("abc-1234") == "ABC1234"
        assert formatar_placa("abc1234") == "ABC-1234"
        assert formatar_placa("ABC1D23") == "ABC1D23"


class TestWhatsapp:
    @pytest.mark.parametrize(
        ("entrada", "esperado"),
        [
            ("(11) 99999-0001", "5511999990001"),
            ("+55 11 99999-0001", "5511999990001"),
            ("11999990001", "5511999990001"),
            ("(21) 8888-7777", "552188887777"),
        ],
    )
    def test_normaliza_variacoes(self, entrada, esperado):
        assert normalizar_whatsapp(entrada) == esperado

    @pytest.mark.parametrize("entrada", ["(01) 99999-0001", "(11) 89999-0001", "99999-0001", "", None])
    def test_rejeita_invalidos(self, entrada):
        assert normalizar_whatsapp(entrada) is None

    def test_link_wa_me(self):
        assert link_whatsapp("5511999990001") == "https://wa.me/5511999990001"
        assert (
            link_whatsapp("+55 (11) 99999-0001", "Olá, tudo bem?")
            == "https://wa.me/5511999990001?text=Ol%C3%A1%2C%20tudo%20bem%3F"
        )


def test_mascaras():
    assert formatar_cpf("52998224725") == "529.982.247-25"
    assert formatar_cpf("5299") == "529.9"
    assert formatar_whatsapp("11999990001") == "(11) 99999-0001"
    assert formatar_whatsapp("1188887777") == "(11) 8888-7777"
    assert formatar_whatsapp("5511999990001") == "(11) 99999-0001"
    assert formatar_whatsapp("1") == "(1"
