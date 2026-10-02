"""
Tratamento de imagens no servidor (Pillow).

O Streamlit recebe o arquivo inteiro do navegador; antes de enviar ao Storage a foto é
corrigida (orientação EXIF), redimensionada e recodificada em JPEG. Fotos de celular
têm 3-12 MB; ~1600 px com qualidade 80 caem para algumas centenas de KB sem perda
perceptível — economiza armazenamento, banda e tempo de carregamento do painel.
"""

from __future__ import annotations

import io
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 120_000_000  # protege contra "decompression bombs"


class ImagemInvalida(ValueError):
    """O arquivo enviado não é uma imagem que possamos processar."""


@dataclass(frozen=True)
class ImagemComprimida:
    dados: bytes
    largura: int
    altura: int
    tamanho_original: int

    @property
    def tamanho(self) -> int:
        return len(self.dados)


def formatar_bytes(n: int) -> str:
    return f"{max(1, round(n / 1024))} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:.1f} MB".replace(".", ",")


def _abrir(dados: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(dados))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ImagemInvalida("Não foi possível ler a imagem. Envie uma foto em JPG, PNG ou WEBP.") from exc
    return ImageOps.exif_transpose(img)  # respeita a orientação "em pé" do celular


def _para_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        fundo = Image.new("RGB", img.size, (255, 255, 255))  # transparência -> fundo branco
        fundo.paste(img, mask=img.getchannel("A"))
        return fundo
    return img.convert("RGB")


def comprimir_imagem(dados: bytes, max_lado: int = 1600, qualidade: int = 80) -> ImagemComprimida:
    img = _para_rgb(_abrir(dados))
    img.thumbnail((max_lado, max_lado), Image.Resampling.LANCZOS)  # só reduz, mantém proporção
    saida = io.BytesIO()
    img.save(saida, format="JPEG", quality=qualidade, optimize=True, progressive=True)
    return ImagemComprimida(saida.getvalue(), img.width, img.height, len(dados))


def _fonte(tamanho: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=tamanho)
    except TypeError:  # Pillow antigo sem parâmetro size
        return ImageFont.load_default()


def desenhar_marcadores(dados: bytes, marcadores: Iterable[Mapping[str, float]]) -> Image.Image:
    """Sobrepõe pins numerados (x, y em % da imagem) para exibição/clique."""
    img = _para_rgb(_abrir(dados))
    draw = ImageDraw.Draw(img)
    raio = max(14, round(min(img.size) * 0.035))
    fonte = _fonte(round(raio * 1.1))
    for i, m in enumerate(marcadores, start=1):
        cx, cy = m["x"] / 100 * img.width, m["y"] / 100 * img.height
        draw.ellipse((cx - raio, cy - raio, cx + raio, cy + raio), fill=(220, 38, 38), outline=(255, 255, 255), width=3)
        draw.text((cx, cy), str(i), fill=(255, 255, 255), font=fonte, anchor="mm")
    return img
