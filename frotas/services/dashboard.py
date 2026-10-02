"""Dados do painel executivo (por filial ou global para o Admin)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from frotas.domain.dates import hoje
from frotas.services.base import executar
from frotas.services.checklists import anexar_referencias
from frotas.services.filiais import listar_filiais
from frotas.services.manutencoes import custos_do_periodo
from frotas.services.painel import VeiculoPainel, todos_veiculos


@dataclass
class ResumoFilial:
    filial: dict[str, Any]
    total: int = 0
    liberado: int = 0
    atencao: int = 0
    manutencao: int = 0
    custo_mes: float = 0.0


@dataclass
class DadosDashboard:
    veiculos: list[VeiculoPainel]
    custo_mes: float
    ultimos_checklists: list[dict[str, Any]]
    filiais: list[dict[str, Any]]
    por_filial: list[ResumoFilial] = field(default_factory=list)

    def contagem(self, saude: str) -> int:
        return sum(v.avaliacao.saude == saude for v in self.veiculos)

    @property
    def requer_atencao(self) -> list[VeiculoPainel]:
        pendentes = [v for v in self.veiculos if v.avaliacao.saude != "liberado"]
        return sorted(pendentes, key=lambda v: (v.avaliacao.saude != "manutencao", v.dados["placa"]))

    @property
    def alertas_revisao(self) -> list[VeiculoPainel]:
        pendentes = [v for v in self.veiculos if v.avaliacao.alerta.nivel != "ok"]
        return sorted(pendentes, key=lambda v: (v.avaliacao.alerta.nivel != "vencido", v.dados["placa"]))


def carregar_dashboard(client: Any, filial_id: str | None, agrupar_por_filial: bool) -> DadosDashboard:
    inicio_mes = hoje().replace(day=1).isoformat()
    veiculos = todos_veiculos(client, filial_id)
    custos = custos_do_periodo(client, inicio_mes, filial_id)

    q = client.table("checklists").select("*").order("data_envio", desc=True).limit(6)
    if filial_id:
        q = q.eq("filial_id", filial_id)
    ultimos = anexar_referencias(client, executar(q).data or [])
    filiais = listar_filiais(client)

    dados = DadosDashboard(
        veiculos=veiculos,
        custo_mes=sum(float(c["custo"]) for c in custos),
        ultimos_checklists=ultimos,
        filiais=filiais,
    )
    if agrupar_por_filial and not filial_id:
        for f in filiais:
            r = ResumoFilial(f)
            for v in (v for v in veiculos if v.dados["filial_id"] == f["id"]):
                r.total += 1
                setattr(r, v.avaliacao.saude, getattr(r, v.avaliacao.saude) + 1)
            r.custo_mes = sum(float(c["custo"]) for c in custos if c["filial_id"] == f["id"])
            dados.por_filial.append(r)
    return dados
