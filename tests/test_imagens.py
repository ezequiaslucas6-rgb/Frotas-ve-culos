import io
import random

import pytest
from PIL import Image

from frotas.domain.imagens import ImagemInvalida, comprimir_imagem, desenhar_marcadores, formatar_bytes


def _jpeg_ruidoso(largura=3000, altura=2000, orientacao=None) -> bytes:
    rnd = random.Random(1)
    img = Image.frombytes("RGB", (largura, altura), bytes(rnd.getrandbits(8) for _ in range(largura * altura * 3)))
    saida = io.BytesIO()
    exif = Image.Exif()
    if orientacao:
        exif[0x0112] = orientacao
    img.save(saida, format="JPEG", quality=95, exif=exif)
    return saida.getvalue()


def test_reduz_o_maior_lado_e_o_tamanho():
    original = _jpeg_ruidoso(1800, 1200)
    r = comprimir_imagem(original, max_lado=1600, qualidade=70)
    assert max(r.largura, r.altura) == 1600 and r.largura / r.altura == pytest.approx(1.5, rel=0.01)
    assert r.tamanho < len(original) and r.tamanho_original == len(original)
    assert Image.open(io.BytesIO(r.dados)).format == "JPEG"


def test_nao_amplia_imagem_pequena():
    r = comprimir_imagem(_jpeg_ruidoso(400, 300))
    assert (r.largura, r.altura) == (400, 300)


def test_respeita_orientacao_exif():
    # orientação 6 = rotacionar 90° => foto 400x200 "deitada" vira 200x400 "em pé"
    r = comprimir_imagem(_jpeg_ruidoso(400, 200, orientacao=6))
    assert (r.largura, r.altura) == (200, 400)


def test_png_com_transparencia_vira_jpeg_com_fundo_branco():
    png = io.BytesIO()
    Image.new("RGBA", (50, 50), (0, 0, 0, 0)).save(png, format="PNG")
    r = comprimir_imagem(png.getvalue())
    pixel = Image.open(io.BytesIO(r.dados)).getpixel((10, 10))
    assert all(c > 240 for c in pixel)


def test_arquivo_invalido():
    with pytest.raises(ImagemInvalida):
        comprimir_imagem(b"isto nao e uma imagem")


def test_marcadores_sao_desenhados_na_posicao():
    base = Image.new("RGB", (400, 300), (10, 10, 10))
    buf = io.BytesIO()
    base.save(buf, format="JPEG")
    img = desenhar_marcadores(buf.getvalue(), [{"x": 50, "y": 50}])
    assert img.size == (400, 300)
    # borda do pin (a 70% do raio, longe do número) é vermelha; o canto continua escuro
    assert img.getpixel((200 - 12, 150))[0] > 150
    assert img.getpixel((5, 5))[0] < 60


def test_formatar_bytes():
    assert formatar_bytes(512) == "1 KB"
    assert formatar_bytes(318 * 1024) == "318 KB"
    assert formatar_bytes(int(1.1 * 1024 * 1024)) == "1,1 MB"
