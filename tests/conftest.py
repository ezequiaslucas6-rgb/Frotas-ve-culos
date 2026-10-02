from __future__ import annotations

import io

import pytest
from PIL import Image

from frotas.infra.cliente import cliente_admin
from frotas.infra.config import Config
from tests.fake_supabase import ANON_KEY, SERVICE_KEY, FakeSupabase, popular_demo


@pytest.fixture(scope="session")
def servidor():
    fake = FakeSupabase().start()
    yield fake
    fake.stop()


@pytest.fixture
def fake(servidor, monkeypatch):
    """Banco falso zerado + dados de demonstração, com as variáveis de ambiente apontando para ele."""
    servidor.reset()
    monkeypatch.setenv("SUPABASE_URL", servidor.url)
    monkeypatch.setenv("SUPABASE_ANON_KEY", ANON_KEY)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    cliente_admin.cache_clear()
    servidor.dados = popular_demo(servidor)
    yield servidor
    cliente_admin.cache_clear()


@pytest.fixture
def config(fake) -> Config:
    return Config(supabase_url=fake.url, supabase_anon_key=ANON_KEY, supabase_service_role_key=SERVICE_KEY)


@pytest.fixture
def jpeg_bytes() -> bytes:
    saida = io.BytesIO()
    Image.new("RGB", (800, 600), (30, 90, 160)).save(saida, format="JPEG")
    return saida.getvalue()
