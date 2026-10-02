"""
Regras de negócio dos alertas de manutenção e da saúde da frota.
Funções PURAS (sem I/O): usadas pelos serviços, pelo cron e pelo painel.

Alerta de revisão preventiva (por KM rodado OU por período - vale o pior):
  vencido -> KM atual >= KM da próxima revisão, ou data da revisão <= hoje
  proximo -> faltam <= MARGEM_ALERTA_KM km, ou <= MARGEM_ALERTA_DIAS dias
  ok      -> dentro do plano (ou veículo sem plano de revisão cadastrado)

Saúde do veículo (badge do painel):
  manutencao (vermelho) -> último checklist crítico (avaria) ainda não tratado, ou revisão vencida
  atencao    (amarelo)  -> último checklist com atenção ainda não tratado, ou revisão próxima
  liberado   (verde)    -> nenhum dos anteriores
"Tratado" = existe manutenção CORRETIVA registrada na data do checklist ou depois.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from frotas.domain.dates import data_do_instante, dias_entre, parse_data, somar_dias
from frotas.domain.dates import hoje as hoje_sp

MARGEM_ALERTA_KM = 1000
MARGEM_ALERTA_DIAS = 15

NivelAlerta = Literal["ok", "proximo", "vencido"]
SaudeVeiculo = Literal["liberado", "atencao", "manutencao"]
StatusChecklist = Literal["ok", "atencao", "critico"]

_SEVERIDADE_ALERTA: dict[str, int] = {"ok": 0, "proximo": 1, "vencido": 2}


@dataclass(frozen=True)
class AlertaRevisao:
    nivel: NivelAlerta
    #: o que disparou o alerta ("km" e/ou "periodo"). Vazio quando nivel == "ok".
    motivos: tuple[str, ...] = ()
    km_restantes: int | None = None
    dias_restantes: int | None = None


def calcular_alerta_revisao(
    km_atual: int,
    proxima_revisao_km: int | None,
    proxima_revisao_data: str | date | None,
    hoje: date | None = None,
    margem_km: int = MARGEM_ALERTA_KM,
    margem_dias: int = MARGEM_ALERTA_DIAS,
) -> AlertaRevisao:
    hoje = hoje or hoje_sp()
    km_restantes = None if proxima_revisao_km is None else proxima_revisao_km - km_atual
    dias_restantes = None if not proxima_revisao_data else dias_entre(hoje, parse_data(proxima_revisao_data))

    nivel: NivelAlerta = "ok"
    motivos: list[str] = []

    def registrar(candidato: str, motivo: str) -> None:
        nonlocal nivel
        if candidato == "ok":
            return
        motivos.append(motivo)
        if _SEVERIDADE_ALERTA[candidato] > _SEVERIDADE_ALERTA[nivel]:
            nivel = candidato  # type: ignore[assignment]

    if km_restantes is not None:
        registrar("vencido" if km_restantes <= 0 else "proximo" if km_restantes <= margem_km else "ok", "km")
    if dias_restantes is not None:
        registrar(
            "vencido" if dias_restantes <= 0 else "proximo" if dias_restantes <= margem_dias else "ok",
            "periodo",
        )
    return AlertaRevisao(nivel, tuple(motivos), km_restantes, dias_restantes)


def proxima_revisao(
    km_registro: int, data_manutencao: str | date, intervalo_km: int, intervalo_dias: int
) -> tuple[int, date]:
    """Próxima revisão a partir de uma preventiva realizada (KM e data + intervalos do veículo)."""
    return km_registro + intervalo_km, somar_dias(parse_data(data_manutencao), intervalo_dias)


@dataclass(frozen=True)
class SaudeAvaliada:
    saude: SaudeVeiculo
    #: motivos legíveis para exibir ao usuário
    motivos: tuple[str, ...] = field(default_factory=tuple)


def avaliar_saude_veiculo(
    ultimo_checklist_status: StatusChecklist | None,
    ultimo_checklist_em: str | None,
    ultima_corretiva_em: str | date | None,
    alerta: NivelAlerta,
) -> SaudeAvaliada:
    motivos: list[str] = []
    saude: SaudeVeiculo = "liberado"

    def piorar(para: SaudeVeiculo) -> None:
        nonlocal saude
        if para == "manutencao" or (para == "atencao" and saude == "liberado"):
            saude = para

    if ultimo_checklist_status and ultimo_checklist_status != "ok" and ultimo_checklist_em:
        tratado = bool(ultima_corretiva_em) and parse_data(ultima_corretiva_em) >= data_do_instante(ultimo_checklist_em)
        if not tratado:
            if ultimo_checklist_status == "critico":
                piorar("manutencao")
                motivos.append("Avaria registrada no último checklist")
            else:
                piorar("atencao")
                motivos.append("Itens em atenção no último checklist")

    if alerta == "vencido":
        piorar("manutencao")
        motivos.append("Revisão preventiva vencida")
    elif alerta == "proximo":
        piorar("atencao")
        motivos.append("Revisão preventiva próxima")

    return SaudeAvaliada(saude, tuple(motivos))


@dataclass(frozen=True)
class AvaliacaoVeiculo:
    alerta: AlertaRevisao
    saude: SaudeVeiculo
    motivos: tuple[str, ...]


def avaliar_veiculo_painel(v: Mapping[str, Any], hoje: date | None = None) -> AvaliacaoVeiculo:
    """Atalho: dado um registro da view vw_veiculos_painel, devolve alerta + saúde."""
    alerta = calcular_alerta_revisao(v["km_atual"], v.get("proxima_revisao_km"), v.get("proxima_revisao_data"), hoje)
    saude = avaliar_saude_veiculo(
        v.get("ultimo_checklist_status"),
        v.get("ultimo_checklist_em"),
        v.get("ultima_corretiva_em"),
        alerta.nivel,
    )
    return AvaliacaoVeiculo(alerta, saude.saude, saude.motivos)


def descrever_alerta(alerta: AlertaRevisao, apenas_disparados: bool = True) -> str:
    """Texto curto do alerta, ex.: 'Faltam 450 km · Vence em 8 dias'."""
    partes: list[str] = []
    if alerta.km_restantes is not None and (not apenas_disparados or "km" in alerta.motivos):
        n = alerta.km_restantes
        partes.append(f"Excedeu {abs(n):,} km".replace(",", ".") if n <= 0 else f"Faltam {n:,} km".replace(",", "."))
    if alerta.dias_restantes is not None and (not apenas_disparados or "periodo" in alerta.motivos):
        d = alerta.dias_restantes
        if d < 0:
            partes.append(f"Vencida há {-d} dia{'' if d == -1 else 's'}")
        elif d == 0:
            partes.append("Vence hoje")
        else:
            partes.append(f"Vence em {d} dia{'' if d == 1 else 's'}")
    return " · ".join(partes) or "Sem plano de revisão"
