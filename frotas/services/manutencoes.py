from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from frotas.domain.alertas import proxima_revisao
from frotas.domain.dates import parse_data
from frotas.infra.auth import Sessao
from frotas.infra.erros import ErroNegocio
from frotas.services.alertas import sincronizar_sem_falhar
from frotas.services.base import buscar_por_ids, executar, intervalo
from frotas.services.validacao import validar_manutencao


@dataclass(frozen=True)
class ResultadoManutencao:
    id: str
    #: aviso quando a manutenção foi gravada mas o KM/plano do veículo não pôde ser atualizado
    aviso: str | None = None


def registrar_manutencao(sessao: Sessao, dados: dict[str, Any]) -> ResultadoManutencao:
    """
    Registra uma manutenção e recalcula os alertas.
      - A filial vem do VEÍCULO (nunca do formulário).
      - Preventiva: define o próximo vencimento (KM + intervalo, data + intervalo) no veículo, desde que seja
        a preventiva mais recente (lançamentos retroativos não "voltam" o plano).
      - Sempre: o KM do veículo só avança.
    """
    client = sessao.client
    m = validar_manutencao(dados)

    achados = (
        executar(
            client.table("veiculos")
            .select("id, filial_id, km_atual, intervalo_revisao_km, intervalo_revisao_dias")
            .eq("id", m["veiculo_id"])
            .limit(1)
        ).data
        or []
    )
    if not achados:
        raise ErroNegocio("Veículo não encontrado.")
    veiculo = achados[0]

    plano = None
    redefine_plano = False
    if m["tipo"] == "preventiva":
        plano = proxima_revisao(
            m["km_registro"], m["data_manutencao"], veiculo["intervalo_revisao_km"], veiculo["intervalo_revisao_dias"]
        )
        ultima = (
            executar(
                client.table("manutencoes")
                .select("data_manutencao")
                .eq("veiculo_id", veiculo["id"])
                .eq("tipo", "preventiva")
                .order("data_manutencao", desc=True)
                .limit(1)
            ).data
            or []
        )
        redefine_plano = not ultima or m["data_manutencao"] >= parse_data(ultima[0]["data_manutencao"])

    criada = executar(
        client.table("manutencoes").insert(
            {
                "veiculo_id": veiculo["id"],
                "filial_id": veiculo["filial_id"],
                "tipo": m["tipo"],
                "descricao": m["descricao"],
                "custo": m["custo"],
                "km_registro": m["km_registro"],
                "data_manutencao": m["data_manutencao"].isoformat(),
                "fornecedor": m["fornecedor"],
                "proxima_revisao_km": plano[0] if plano else None,
                "proxima_revisao_data": plano[1].isoformat() if plano else None,
            }
        )
    ).data[0]

    aviso = None
    atualizacao: dict[str, Any] = {"km_atual": max(veiculo["km_atual"], m["km_registro"])}
    if redefine_plano and plano:
        atualizacao |= {"proxima_revisao_km": plano[0], "proxima_revisao_data": plano[1].isoformat()}
    try:
        executar(client.table("veiculos").update(atualizacao).eq("id", veiculo["id"]))
        if redefine_plano:  # preventivas anteriores deixam de carregar alerta
            executar(
                client.table("manutencoes")
                .update({"status_alerta": "ok"})
                .eq("veiculo_id", veiculo["id"])
                .eq("tipo", "preventiva")
                .neq("id", criada["id"])
            )
    except ErroNegocio:
        aviso = (
            "Manutenção registrada, mas não foi possível atualizar o KM/plano do veículo. Edite o veículo manualmente."
        )
    sincronizar_sem_falhar(client, veiculo["id"])
    return ResultadoManutencao(criada["id"], aviso)


@dataclass(frozen=True)
class FiltroManutencao:
    filial_id: str | None = None
    tipo: str | None = None
    mes: str | None = None  # 'YYYY-MM'

    def periodo(self) -> tuple[str, str] | None:
        if not self.mes or len(self.mes) != 7:
            return None
        try:
            ano, mes = int(self.mes[:4]), int(self.mes[5:7])
        except ValueError:
            return None
        if not 1 <= mes <= 12:
            return None
        fim = f"{ano + 1}-01-01" if mes == 12 else f"{ano}-{mes + 1:02d}-01"
        return f"{ano}-{mes:02d}-01", fim


def _aplicar(q: Any, f: FiltroManutencao) -> Any:
    if f.filial_id:
        q = q.eq("filial_id", f.filial_id)
    if f.tipo in ("preventiva", "corretiva"):
        q = q.eq("tipo", f.tipo)
    periodo = f.periodo()
    if periodo:
        q = q.gte("data_manutencao", periodo[0]).lt("data_manutencao", periodo[1])
    return q


def listar_manutencoes(
    client: Any, f: FiltroManutencao, pagina: int = 1, tamanho: int = 20
) -> tuple[list[dict[str, Any]], int]:
    de, ate = intervalo(pagina, tamanho)
    q = (
        client.table("manutencoes")
        .select("*", count="exact")
        .order("data_manutencao", desc=True)
        .order("created_at", desc=True)
        .range(de, ate)
    )
    resp = executar(_aplicar(q, f))
    linhas = resp.data or []
    veiculos = buscar_por_ids(client, "veiculos", [m["veiculo_id"] for m in linhas], "id, placa, marca, modelo")
    filiais = buscar_por_ids(client, "filiais", [m["filial_id"] for m in linhas], "id, nome_cidade, uf")
    return [
        {**m, "veiculo": veiculos.get(m["veiculo_id"]), "filial": filiais.get(m["filial_id"])} for m in linhas
    ], resp.count or 0


def totais_de_custo(client: Any, f: FiltroManutencao) -> dict[str, float]:
    """Soma de custos (total/preventivas/corretivas) para o filtro, paginando além do teto de 1.000 linhas."""
    total = {"total": 0.0, "preventiva": 0.0, "corretiva": 0.0}
    de, passo = 0, 1000
    while True:
        linhas = (
            executar(
                _aplicar(client.table("manutencoes").select("custo, tipo").order("id").range(de, de + passo - 1), f)
            ).data
            or []
        )
        for m in linhas:
            total["total"] += float(m["custo"])
            total[m["tipo"]] += float(m["custo"])
        if len(linhas) < passo:
            return total
        de += passo


def custos_do_periodo(client: Any, desde: str, filial_id: str | None = None) -> list[dict[str, Any]]:
    """(custo, filial_id) das manutenções a partir de `desde` (YYYY-MM-DD) — usado no painel."""
    q = client.table("manutencoes").select("custo, filial_id").gte("data_manutencao", desde).range(0, 4999)
    if filial_id:
        q = q.eq("filial_id", filial_id)
    return executar(q).data or []


def excluir_manutencao(sessao: Sessao, manutencao_id: str) -> None:
    sessao.exigir_admin()
    removidas = executar(sessao.client.table("manutencoes").delete().eq("id", manutencao_id)).data
    if not removidas:
        raise ErroNegocio("Manutenção não encontrada.")
