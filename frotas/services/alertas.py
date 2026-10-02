"""Sincronização dos alertas de revisão (persiste manutencoes.status_alerta)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from frotas.domain.alertas import calcular_alerta_revisao
from frotas.domain.dates import hoje
from frotas.infra.erros import ErroNegocio
from frotas.services.base import em_lotes, executar

_PAGINA = 1000


@dataclass
class ResumoAlertas:
    veiculos: int = 0
    vencidos: int = 0
    proximos: int = 0
    #: quantidade de registros de manutenção cujo status_alerta mudou
    atualizados: int = 0


def sincronizar_alertas(client: Any, veiculo_id: str | None = None, filial_id: str | None = None) -> ResumoAlertas:
    """
    Recalcula o alerta de revisão e persiste `manutencoes.status_alerta` na última preventiva de
    cada veículo (a que "carrega" o plano vigente).

    O escopo é definido pela PRÓPRIA RLS do cliente: com o cliente do usuário só enxerga a(s)
    filial(is) dele; com o cliente admin (cron) varre a frota inteira.
    """
    data_hoje = hoje()
    resumo = ResumoAlertas()
    ids_por_nivel: dict[str, list[str]] = {"ok": [], "proximo": [], "vencido": []}

    de = 0
    while True:
        q = (
            client.table("vw_veiculos_painel")
            .select("id, km_atual, proxima_revisao_km, proxima_revisao_data, ultima_preventiva_id")
            .order("id")
            .range(de, de + _PAGINA - 1)
        )
        if veiculo_id:
            q = q.eq("id", veiculo_id)
        if filial_id:
            q = q.eq("filial_id", filial_id)
        linhas = executar(q).data or []

        for v in linhas:
            nivel = calcular_alerta_revisao(
                v["km_atual"], v.get("proxima_revisao_km"), v.get("proxima_revisao_data"), data_hoje
            ).nivel
            resumo.veiculos += 1
            resumo.vencidos += nivel == "vencido"
            resumo.proximos += nivel == "proximo"
            if v.get("ultima_preventiva_id"):
                ids_por_nivel[nivel].append(v["ultima_preventiva_id"])
        if len(linhas) < _PAGINA:
            break
        de += _PAGINA

    for nivel, ids in ids_por_nivel.items():
        for lote in em_lotes(ids):
            alterados = executar(
                client.table("manutencoes")
                .update({"status_alerta": nivel})
                .in_("id", list(lote))
                .neq("status_alerta", nivel)
            ).data
            resumo.atualizados += len(alterados or [])
    return resumo


def sincronizar_sem_falhar(client: Any, veiculo_id: str) -> None:
    """Uso após gravações: a falha ao recalcular alertas não deve desfazer a operação principal."""
    import logging

    try:
        sincronizar_alertas(client, veiculo_id=veiculo_id)
    except ErroNegocio:
        logging.getLogger(__name__).warning("Falha ao sincronizar alertas do veículo %s", veiculo_id, exc_info=True)
