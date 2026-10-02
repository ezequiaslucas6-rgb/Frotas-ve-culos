"""
Fixtures E2E: sobem o Supabase falso + o Streamlit REAL (subprocesso) e entregam um navegador Chromium.

    pip install -r requirements-dev.txt && playwright install chromium
    pytest -m e2e

Variável opcional CHROMIUM_PATH aponta para um Chromium já instalado.
"""

from __future__ import annotations

import io
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from PIL import Image

from tests.fake_supabase import ANON_KEY, SERVICE_KEY, FakeSupabase, popular_demo

RAIZ = Path(__file__).resolve().parents[2]


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def fake_e2e():
    fake = FakeSupabase().start()
    yield fake
    fake.stop()


@pytest.fixture(scope="session")
def app_url(fake_e2e):
    porta = _porta_livre()
    env = {
        **os.environ,
        "SUPABASE_URL": fake_e2e.url,
        "SUPABASE_ANON_KEY": ANON_KEY,
        "SUPABASE_SERVICE_ROLE_KEY": SERVICE_KEY,
        "PYTHONPATH": str(RAIZ),
    }
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "streamlit",
            "run",
            "streamlit_app.py",
            "--server.port",
            str(porta),
            "--server.headless",
            "true",
            "--browser.gatherUsageStats",
            "false",
        ],
        cwd=RAIZ,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{porta}"
    for _ in range(60):
        try:
            if urllib.request.urlopen(f"{url}/_stcore/health", timeout=1).status == 200:
                break
        except OSError:
            time.sleep(0.5)
    else:
        proc.kill()
        raise RuntimeError("Streamlit não subiu a tempo")
    yield url
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture(scope="session")
def navegador():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        caminho = os.environ.get("CHROMIUM_PATH")
        if not caminho:
            candidatos = sorted(Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome"))
            caminho = str(candidatos[-1]) if candidatos else None
        b = p.chromium.launch(
            executable_path=caminho,
            args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],  # webcam simulada
        )
        yield b
        b.close()


@pytest.fixture
def mundo_e2e(fake_e2e):
    """Estado limpo do banco a cada teste."""
    fake_e2e.reset()
    fake_e2e.dados = popular_demo(fake_e2e)
    return fake_e2e


@pytest.fixture
def foto_jpeg(tmp_path):
    """Gera JPEGs grandes e distintos (exercita a compressão)."""

    def gerar(nome: str, cor: tuple[int, int, int]) -> Path:
        import random

        rnd = random.Random(sum(cor))
        img = Image.new("RGB", (2400, 1600), cor)
        px = img.load()
        for _ in range(3000):
            x, y = rnd.randrange(2300), rnd.randrange(1500)
            for dx in range(60):
                for dy in range(60):
                    px[x + dx, y + dy] = (rnd.randrange(256), rnd.randrange(256), rnd.randrange(256))
        saida = io.BytesIO()
        img.save(saida, format="JPEG", quality=95)
        caminho = tmp_path / nome
        caminho.write_bytes(saida.getvalue())
        return caminho

    return gerar
