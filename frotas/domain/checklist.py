"""As 14 etapas obrigatórias do checklist fotográfico e regras de severidade."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

Severidade = Literal["ok", "atencao", "critico"]


@dataclass(frozen=True)
class Etapa:
    categoria: str  # valor do enum categoria_foto no banco
    titulo: str
    dica: str


#: As 14 etapas, na ordem de execução do wizard.
ETAPAS: tuple[Etapa, ...] = (
    Etapa("lateral_direita", "Lateral direita", "Enquadre o veículo inteiro, do para-choque dianteiro ao traseiro."),
    Etapa("lateral_esquerda", "Lateral esquerda", "Enquadre o veículo inteiro, do para-choque dianteiro ao traseiro."),
    Etapa("frente", "Frente", "Fotografe de frente, mostrando para-choque, capô e faróis."),
    Etapa("traseira", "Parte de trás", "Fotografe de trás, mostrando para-choque, placa e lanternas."),
    Etapa(
        "carroceria_portamalas",
        "Carroceria ou porta-malas",
        "Abra o porta-malas/carroceria e mostre limpeza, estepe e carga.",
    ),
    Etapa("interior", "Interior do veículo", "Mostre bancos, forro e limpeza da cabine."),
    Etapa(
        "painel",
        "Painel (hodômetro / combustível)",
        "Com o veículo ligado: hodômetro, nível de combustível e luzes de alerta legíveis.",
    ),
    Etapa(
        "rodas",
        "4 rodas (pneus e aros)",
        "Mostre o estado de pneus e aros. Se não couber em uma foto, enquadre o conjunto.",
    ),
    Etapa("nivel_oleo", "Nível de óleo", "Mostre a vareta de óleo retirada, com o nível visível."),
    Etapa(
        "nivel_agua", "Nível de água / arrefecimento", "Mostre o reservatório de arrefecimento com as marcas de nível."
    ),
    Etapa("motor", "Motor", "Capô aberto, enquadrando o compartimento do motor."),
    Etapa("retrovisores", "Retrovisores", "Mostre os dois retrovisores (espelho e carcaça)."),
    Etapa("para_brisa", "Para-brisa", "Mostre o para-brisa e as palhetas; atenção a trincas e lascas."),
    Etapa(
        "luzes_sinalizacao", "Luzes / sinalização", "Faróis, setas e lanternas acesos (use um ajudante para conferir)."
    ),
)

TOTAL_ETAPAS = len(ETAPAS)
ETAPA_POR_CATEGORIA: dict[str, Etapa] = {e.categoria: e for e in ETAPAS}
CATEGORIAS: tuple[str, ...] = tuple(e.categoria for e in ETAPAS)

SEVERIDADE_LABEL: dict[str, str] = {"ok": "Conforme", "atencao": "Atenção", "critico": "Avaria"}
SEVERIDADE_ICONE: dict[str, str] = {"ok": "✅", "atencao": "⚠️", "critico": "🛑"}
SEVERIDADES: tuple[str, ...] = ("ok", "atencao", "critico")
_PESO: dict[str, int] = {"ok": 0, "atencao": 1, "critico": 2}


def status_geral(severidades: Iterable[str]) -> Severidade:
    """Status geral do checklist: a pior severidade entre os itens (mesma regra da RPC salvar_checklist)."""
    pior = "ok"
    for s in severidades:
        if _PESO[s] > _PESO[pior]:
            pior = s
    return pior  # type: ignore[return-value]


def contar_severidades(severidades: Iterable[str]) -> dict[str, int]:
    total = {"ok": 0, "atencao": 0, "critico": 0}
    for s in severidades:
        total[s] += 1
    return total


def caminho_foto(filial_id: str, checklist_id: str, categoria: str) -> str:
    """Caminho no bucket 'checklists': <filial>/<checklist>/<categoria>.jpg"""
    return f"{filial_id}/{checklist_id}/{categoria}.jpg"
