"""
Supabase falso, em memória, SOMENTE para testes (pytest e E2E).

Implementa o mínimo de Auth (GoTrue), REST (estilo PostgREST) e Storage que o app usa, para que os
serviços sejam exercitados pelo `supabase-py` REAL, via HTTP. Espelha de forma simplificada a RLS:
supervisores só leem/escrevem registros da própria filial; exclusões são de admin.

A RLS de verdade (políticas SQL) é validada em supabase/tests/rls.test.ts.

Uso avulso (demo/E2E):  python -m tests.fake_supabase --port 54321
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import threading
import time
import uuid
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

SERVICE_KEY = "service-role-key-de-teste"
ANON_KEY = "anon-key-de-teste"

CATEGORIAS = [
    "lateral_direita", "lateral_esquerda", "frente", "traseira", "carroceria_portamalas", "interior", "painel",
    "rodas", "nivel_oleo", "nivel_agua", "motor", "retrovisores", "para_brisa", "luzes_sinalizacao",
]  # fmt: skip
ESCOPO_FILIAL = {"veiculos", "motoristas", "checklists", "manutencoes", "vw_veiculos_painel"}
SO_ADMIN_DELETA = {"veiculos", "motoristas", "checklists", "manutencoes", "filiais", "profiles", "checklist_fotos"}
UNICOS = {
    "veiculos": [("placa",)],
    "motoristas": [("filial_id", "cpf")],
    "filiais": [("nome_cidade", "uf")],
}
UNICO_NOME = {
    "veiculos": "veiculos_placa_key",
    "motoristas": "motoristas_filial_id_cpf_key",
    "filiais": "filiais_nome_cidade_uf_key",
}
# (tabela filha, coluna) que impede a exclusão da tabela pai (FK ... on delete restrict)
DEPENDENTES = {
    "veiculos": [("checklists", "veiculo_id"), ("manutencoes", "veiculo_id")],
    "motoristas": [("checklists", "motorista_id")],
    "filiais": [("veiculos", "filial_id"), ("motoristas", "filial_id"), ("profiles", "filial_id")],
}


def _agora() -> str:
    return datetime.now(UTC).isoformat()


def _b64(obj: Any) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def _jwt(sub: str, exp: int) -> str:
    return f"{_b64({'alg': 'HS256', 'typ': 'JWT'})}.{_b64({'sub': sub, 'role': 'authenticated', 'aud': 'authenticated', 'exp': exp})}.assinatura"


def _sub_do_jwt(token: str) -> str | None:
    try:
        corpo = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(corpo + "=" * (-len(corpo) % 4)))["sub"]
    except Exception:
        return None


class Erro(Exception):
    def __init__(self, status: int, code: str, message: str, details: str | None = None):
        self.status, self.payload = status, {"code": code, "message": message, "details": details, "hint": None}


class FakeSupabase:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.log: list[str] = []
        self.reset()
        self._server: ThreadingHTTPServer | None = None
        self.port = 0

    # ---------------------------------------------------------------- estado
    def reset(self) -> None:
        with self.lock:
            self.tables: dict[str, list[dict[str, Any]]] = {
                n: []
                for n in (
                    "filiais",
                    "profiles",
                    "motoristas",
                    "veiculos",
                    "checklists",
                    "checklist_fotos",
                    "manutencoes",
                    "checklist_rascunhos",
                )
            }
            self.users: dict[str, dict[str, Any]] = {}
            self.refresh_tokens: dict[str, str] = {}  # refresh_token -> user_id
            self.storage: dict[str, bytes] = {}
            self.log = []

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def add_filial(self, nome: str, uf: str) -> dict[str, Any]:
        row = {"id": str(uuid.uuid4()), "nome_cidade": nome, "uf": uf, "created_at": _agora()}
        self.tables["filiais"].append(row)
        return row

    def add_user(
        self,
        email: str,
        senha: str,
        nome: str,
        role: str = "supervisor",
        filial_id: str | None = None,
        perfil: bool = True,
    ) -> dict[str, Any]:
        uid = str(uuid.uuid4())
        self.users[uid] = {
            "id": uid,
            "email": email.lower(),
            "password": senha,
            "aud": "authenticated",
            "role": "authenticated",
            "app_metadata": {},
            "user_metadata": {},
            "created_at": _agora(),
        }
        if perfil:
            self.tables["profiles"].append(
                {"id": uid, "nome": nome, "role": role, "filial_id": filial_id, "created_at": _agora()}
            )
        return self.users[uid]

    def add_veiculo(self, filial_id: str, placa: str, **extra: Any) -> dict[str, Any]:
        row = {
            "id": str(uuid.uuid4()), "filial_id": filial_id, "placa": placa, "marca": None, "modelo": None, "ano": None,
            "documento_url": None, "foto_geral_url": None, "km_atual": 0, "intervalo_revisao_km": 10000,
            "intervalo_revisao_dias": 180, "proxima_revisao_km": None, "proxima_revisao_data": None, "created_at": _agora(),
        }  # fmt: skip
        row.update(extra)
        self.tables["veiculos"].append(row)
        return row

    def add_motorista(self, filial_id: str, nome: str, cpf: str, **extra: Any) -> dict[str, Any]:
        row = {
            "id": str(uuid.uuid4()),
            "filial_id": filial_id,
            "nome": nome,
            "cpf": cpf,
            "email": f"{cpf}@x.com",
            "whatsapp": "5511999990001",
            "cnh": "22522791508",
            "status": "ativo",
            "created_at": _agora(),
        }
        row.update(extra)
        self.tables["motoristas"].append(row)
        return row

    # ---------------------------------------------------------------- view
    def _painel(self) -> list[dict[str, Any]]:
        linhas = []
        for v in self.tables["veiculos"]:
            f = next((x for x in self.tables["filiais"] if x["id"] == v["filial_id"]), {})
            cks = sorted(
                (c for c in self.tables["checklists"] if c["veiculo_id"] == v["id"]),
                key=lambda c: c["data_envio"],
                reverse=True,
            )
            corretivas = [
                m["data_manutencao"]
                for m in self.tables["manutencoes"]
                if m["veiculo_id"] == v["id"] and m["tipo"] == "corretiva"
            ]
            preventivas = sorted(
                (m for m in self.tables["manutencoes"] if m["veiculo_id"] == v["id"] and m["tipo"] == "preventiva"),
                key=lambda m: (m["data_manutencao"], m["created_at"]), reverse=True,
            )  # fmt: skip
            linhas.append({
                **{k: v[k] for k in ("id", "filial_id", "placa", "marca", "modelo", "ano", "km_atual", "foto_geral_url", "documento_url", "intervalo_revisao_km", "intervalo_revisao_dias", "proxima_revisao_km", "proxima_revisao_data", "created_at")},
                "nome_cidade": f.get("nome_cidade"), "uf": f.get("uf"),
                "ultimo_checklist_id": cks[0]["id"] if cks else None,
                "ultimo_checklist_status": cks[0]["status"] if cks else None,
                "ultimo_checklist_em": cks[0]["data_envio"] if cks else None,
                "ultima_corretiva_em": max(corretivas) if corretivas else None,
                "ultima_preventiva_id": preventivas[0]["id"] if preventivas else None,
            })  # fmt: skip
        return linhas

    # ---------------------------------------------------------------- autorização
    def _ator(self, headers: Any) -> dict[str, Any]:
        """Quem está chamando: service role (bypass), usuário autenticado (perfil) ou anônimo."""
        token = (headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        if token == SERVICE_KEY:
            return {"admin": True, "filial_id": None, "uid": None, "service": True}
        uid = _sub_do_jwt(token) if token else None
        perfil = next((p for p in self.tables["profiles"] if p["id"] == uid), None)
        if not perfil:
            return {"admin": False, "filial_id": None, "uid": uid, "anon": uid is None, "sem_perfil": True}
        return {"admin": perfil["role"] == "admin", "filial_id": perfil["filial_id"], "uid": uid}

    def _visiveis(self, tabela: str, ator: dict[str, Any]) -> list[dict[str, Any]]:
        linhas = self._painel() if tabela == "vw_veiculos_painel" else self.tables[tabela]
        if ator.get("service") or ator["admin"]:
            return linhas
        if ator.get("anon") or (ator.get("sem_perfil") and tabela != "profiles"):
            return []
        fid = ator["filial_id"]
        if tabela in ESCOPO_FILIAL:
            return [r for r in linhas if r["filial_id"] == fid]
        if tabela == "filiais":
            return [r for r in linhas if r["id"] == fid]
        if tabela == "profiles":
            return [r for r in linhas if r["id"] == ator["uid"] or (r["filial_id"] and r["filial_id"] == fid)]
        if tabela == "checklist_fotos":
            ids = {c["id"] for c in self.tables["checklists"] if c["filial_id"] == fid}
            return [r for r in linhas if r["checklist_id"] in ids]
        if tabela == "checklist_rascunhos":
            return [r for r in linhas if r["user_id"] == ator["uid"]]
        return linhas

    # ---------------------------------------------------------------- filtros PostgREST
    @staticmethod
    def _cmp(valor: Any, op: str, alvo: str) -> bool:
        s = "" if valor is None else str(valor)
        if op == "eq":
            return s == alvo
        if op == "neq":
            return s != alvo
        if op == "gte":
            return valor is not None and s >= alvo
        if op == "lt":
            return valor is not None and s < alvo
        if op == "gt":
            return valor is not None and s > alvo
        if op == "lte":
            return valor is not None and s <= alvo
        if op == "ilike":
            return bool(re.match("^" + re.escape(alvo).replace("%", ".*").replace("_", ".") + "$", s, re.I))
        if op == "in":
            itens = [i.strip().strip('"') for i in alvo.strip("()").split(",") if i.strip()]
            return s in itens
        if op == "is":
            return (valor is None) if alvo == "null" else str(valor).lower() == alvo
        raise Erro(400, "PGRST100", f"operador não suportado: {op}")

    def _filtrar(self, linhas: list[dict[str, Any]], params: dict[str, list[str]]) -> list[dict[str, Any]]:
        for chave, valores in params.items():
            if chave in ("select", "order", "limit", "offset", "on_conflict", "columns"):
                continue
            for valor in valores:
                if chave == "or":
                    condicoes = [c.split(".", 2) for c in valor.strip("()").split(",")]
                    linhas = [r for r in linhas if any(self._cmp(r.get(c[0]), c[1], c[2]) for c in condicoes)]
                else:
                    op, _, alvo = valor.partition(".")
                    linhas = [r for r in linhas if self._cmp(r.get(chave), op, alvo)]
        return linhas

    # ---------------------------------------------------------------- REST
    def rest(
        self, metodo: str, tabela: str, params: dict[str, list[str]], corpo: Any, headers: Any
    ) -> tuple[int, Any, dict[str, str]]:
        ator = self._ator(headers)
        prefer = headers.get("Prefer", "")
        if tabela not in self.tables and tabela != "vw_veiculos_painel":
            raise Erro(404, "PGRST205", f"Could not find the table 'public.{tabela}'")
        if ator.get("anon"):
            raise Erro(401, "PGRST301", "JWT required")

        if metodo == "GET":
            linhas = self._filtrar(self._visiveis(tabela, ator), params)
            for ordem in reversed((params.get("order") or [""])[0].split(",")):
                if ordem:
                    col, _, sent = ordem.partition(".")
                    linhas = sorted(
                        linhas, key=lambda r, c=col: (r.get(c) is None, str(r.get(c) or "")), reverse=sent == "desc"
                    )
            total = len(linhas)
            de = int((params.get("offset") or ["0"])[0])
            limite = int((params.get("limit") or [str(10**9)])[0])
            linhas = linhas[de : de + limite]
            colunas = (params.get("select") or ["*"])[0]
            if colunas != "*":
                cols = [c.strip() for c in colunas.split(",") if c.strip() and "(" not in c]
                linhas = [{c: r.get(c) for c in cols} for r in linhas]
            extra = {}
            if "count=exact" in prefer:
                extra["Content-Range"] = f"{de}-{de + max(len(linhas) - 1, 0)}/{total}" if linhas else f"*/{total}"
            return 200, linhas, extra

        if metodo == "POST":
            itens = corpo if isinstance(corpo, list) else [corpo]
            salvos = [
                self._inserir(
                    tabela, dict(i), ator, "merge-duplicates" in prefer, (params.get("on_conflict") or [None])[0]
                )
                for i in itens
            ]
            return 201, salvos if "return=representation" in prefer else None, {}

        if metodo == "PATCH":
            alvos = self._filtrar(self._visiveis(tabela, ator), params)
            for r in alvos:
                novo = {**r, **corpo}
                if not ator["admin"] and tabela in ESCOPO_FILIAL and novo.get("filial_id") != ator["filial_id"]:
                    raise Erro(403, "42501", f'new row violates row-level security policy for table "{tabela}"')
                if tabela in ("checklists", "checklist_fotos", "profiles", "filiais") and not ator["admin"]:
                    raise Erro(403, "42501", f'new row violates row-level security policy for table "{tabela}"')
                self._checar_unico(tabela, novo, ignorar=r)
                r.update(corpo)
            return 200, alvos if "return=representation" in prefer else None, {}

        if metodo == "DELETE":
            if tabela == "checklist_rascunhos":
                alvos = self._filtrar(self._visiveis(tabela, ator), params)
            elif tabela in SO_ADMIN_DELETA and not ator["admin"]:
                alvos = []  # a RLS filtra silenciosamente: 0 linhas afetadas
            else:
                alvos = self._filtrar(self._visiveis(tabela, ator), params)
            for r in alvos:
                for filha, coluna in DEPENDENTES.get(tabela, []):
                    if any(x[coluna] == r["id"] for x in self.tables[filha]):
                        raise Erro(
                            409,
                            "23503",
                            f'update or delete on table "{tabela}" violates foreign key constraint on table "{filha}"',
                        )
            for r in alvos:
                self.tables[tabela].remove(r)
                if tabela == "checklists":
                    self.tables["checklist_fotos"] = [
                        f for f in self.tables["checklist_fotos"] if f["checklist_id"] != r["id"]
                    ]
            return 200, alvos if "return=representation" in prefer else None, {}

        raise Erro(405, "PGRST117", "método não suportado")

    def _checar_unico(self, tabela: str, linha: dict[str, Any], ignorar: dict[str, Any] | None = None) -> None:
        for cols in UNICOS.get(tabela, []):
            if any(o is not ignorar and all(o.get(c) == linha.get(c) for c in cols) for o in self.tables[tabela]):
                nome = UNICO_NOME[tabela]
                raise Erro(
                    409,
                    "23505",
                    f'duplicate key value violates unique constraint "{nome}"',
                    f"Key ({', '.join(cols)}) already exists.",
                )

    def _inserir(
        self, tabela: str, linha: dict[str, Any], ator: dict[str, Any], upsert: bool, on_conflict: str | None
    ) -> dict[str, Any]:
        if not ator["admin"] and tabela in ("filiais", "profiles"):
            raise Erro(403, "42501", f'new row violates row-level security policy for table "{tabela}"')
        if not ator["admin"] and tabela in ESCOPO_FILIAL and linha.get("filial_id") != ator["filial_id"]:
            raise Erro(403, "42501", f'new row violates row-level security policy for table "{tabela}"')
        if tabela == "checklist_rascunhos":
            linha.setdefault("user_id", ator["uid"])
            if linha["user_id"] != ator["uid"]:
                raise Erro(403, "42501", 'new row violates row-level security policy for table "checklist_rascunhos"')
            existente = next((r for r in self.tables[tabela] if r["user_id"] == linha["user_id"]), None)
            if existente and upsert:
                existente.update(linha)
                return existente
        defaults: dict[str, Any] = {"created_at": _agora()}
        if tabela != "checklist_rascunhos":
            defaults["id"] = str(uuid.uuid4())
        defaults |= {
            "veiculos": {"km_atual": 0, "intervalo_revisao_km": 10000, "intervalo_revisao_dias": 180, "marca": None, "modelo": None, "ano": None, "documento_url": None, "foto_geral_url": None, "proxima_revisao_km": None, "proxima_revisao_data": None},
            "motoristas": {"status": "ativo"},
            "manutencoes": {"status_alerta": "ok", "custo": 0, "fornecedor": None, "proxima_revisao_km": None, "proxima_revisao_data": None, "created_by": ator["uid"]},
        }.get(tabela, {})  # fmt: skip
        novo = {**defaults, **linha}
        if tabela == "manutencoes" and not any(
            v["id"] == novo["veiculo_id"] and v["filial_id"] == novo["filial_id"] for v in self.tables["veiculos"]
        ):
            raise Erro(
                409,
                "23503",
                'insert or update on table "manutencoes" violates foreign key constraint "manutencoes_veiculo_fk"',
            )
        self._checar_unico(tabela, novo)
        self.tables[tabela].append(novo)
        return novo

    # ---------------------------------------------------------------- RPC
    def rpc(self, nome: str, corpo: dict[str, Any], headers: Any) -> Any:
        ator = self._ator(headers)
        if nome != "salvar_checklist":
            raise Erro(404, "PGRST202", f"função {nome} não existe")
        v = next((x for x in self._visiveis("veiculos", ator) if x["id"] == corpo["p_veiculo_id"]), None)
        if not v:
            raise Erro(403, "42501", "Veículo não encontrado ou sem permissão de acesso")
        fotos = corpo["p_fotos"]
        if len(fotos) != len(CATEGORIAS) or len({f["categoria_foto"] for f in fotos}) != len(CATEGORIAS):
            raise Erro(400, "23514", f"O checklist exige as {len(CATEGORIAS)} fotos obrigatórias (uma por categoria)")
        if any(c["id"] == corpo["p_id"] for c in self.tables["checklists"]):
            raise Erro(409, "23505", 'duplicate key value violates unique constraint "checklists_pkey"')
        peso = {"ok": 0, "atencao": 1, "critico": 2}
        status = max((f.get("severidade", "ok") for f in fotos), key=lambda s: peso[s])
        self.tables["checklists"].append({
            "id": corpo["p_id"], "veiculo_id": v["id"], "motorista_id": corpo["p_motorista_id"], "filial_id": v["filial_id"],
            "supervisor_id": ator["uid"], "data_envio": _agora(), "observacoes_gerais": (corpo.get("p_observacoes") or "").strip() or None,
            "status": status, "km_registro": corpo.get("p_km"),
        })  # fmt: skip
        for f in fotos:
            self.tables["checklist_fotos"].append({
                "id": str(uuid.uuid4()), "checklist_id": corpo["p_id"], "categoria_foto": f["categoria_foto"], "foto_url": f["foto_url"],
                "observacao": f.get("observacao"), "severidade": f.get("severidade", "ok"), "marcadores": f.get("marcadores", []), "created_at": _agora(),
            })  # fmt: skip
        if corpo.get("p_km") is not None:
            v["km_atual"] = max(v["km_atual"], corpo["p_km"])
        return corpo["p_id"]

    # ---------------------------------------------------------------- Auth
    def _sessao(self, user: dict[str, Any]) -> dict[str, Any]:
        exp = int(time.time()) + 3600
        refresh = f"rt-{uuid.uuid4()}"
        self.refresh_tokens[refresh] = user["id"]
        publico = {k: v for k, v in user.items() if k != "password"}
        return {
            "access_token": _jwt(user["id"], exp),
            "token_type": "bearer",
            "expires_in": 3600,
            "expires_at": exp,
            "refresh_token": refresh,
            "user": publico,
        }

    def auth(
        self, metodo: str, caminho: str, params: dict[str, list[str]], corpo: Any, headers: Any
    ) -> tuple[int, Any]:
        if caminho == "token":
            tipo = (params.get("grant_type") or [""])[0]
            if tipo == "password":
                user = next(
                    (
                        u
                        for u in self.users.values()
                        if u["email"] == str(corpo.get("email", "")).lower() and u["password"] == corpo.get("password")
                    ),
                    None,
                )
                if not user:
                    raise Erro(400, "invalid_credentials", "Invalid login credentials")
                return 200, self._sessao(user)
            if tipo == "refresh_token":
                uid = self.refresh_tokens.pop(corpo.get("refresh_token", ""), None)  # rotação: uso único
                if not uid or uid not in self.users:
                    raise Erro(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found")
                return 200, self._sessao(self.users[uid])
        ator = self._ator(headers)
        if caminho == "user":
            uid = ator.get("uid")
            if not uid or uid not in self.users:
                raise Erro(401, "bad_jwt", "invalid JWT")
            return 200, {k: v for k, v in self.users[uid].items() if k != "password"}
        if caminho == "logout":
            return 204, None
        if caminho.startswith("admin/users"):
            if not ator.get("service"):
                raise Erro(403, "not_admin", "User not allowed")
            if metodo == "GET":
                return 200, {
                    "users": [{k: v for k, v in u.items() if k != "password"} for u in self.users.values()],
                    "aud": "authenticated",
                }
            if metodo == "POST":
                if any(u["email"] == corpo["email"].lower() for u in self.users.values()):
                    raise Erro(422, "email_exists", "A user with this email address has already been registered")
                u = self.add_user(corpo["email"], corpo["password"], "", perfil=False)
                u["user_metadata"] = corpo.get("user_metadata", {})
                return 200, {k: v for k, v in u.items() if k != "password"}
            if metodo == "DELETE":
                uid = caminho.split("/")[-1]
                if any(c["supervisor_id"] == uid for c in self.tables["checklists"]):
                    raise Erro(500, "unexpected_failure", "Database error deleting user")
                self.users.pop(uid, None)
                self.tables["profiles"] = [p for p in self.tables["profiles"] if p["id"] != uid]
                return 200, {}
        raise Erro(404, "not_found", f"auth: {metodo} {caminho}")

    # ---------------------------------------------------------------- Storage
    def storage_req(
        self, metodo: str, caminho: str, corpo: bytes, content_type: str, headers: Any
    ) -> tuple[int, Any, str]:
        ator = self._ator(headers)
        partes = caminho.split("/")  # object/<...>
        assinada_get = partes[:2] == ["object", "sign"] and metodo == "GET"  # URL assinada: o token vai na query
        if ator.get("anon") and not assinada_get:
            return 401, {"statusCode": "401", "error": "Unauthorized", "message": "JWT required"}, "json"
        if partes[:2] == ["object", "list"] and metodo == "POST":
            bucket, req = partes[2], json.loads(corpo or b"{}")
            base = f"{bucket}/{req.get('prefix', '').strip('/')}/"
            nomes = [
                {"name": k[len(base) :].split("/")[0], "id": str(uuid.uuid4())}
                for k in sorted(self.storage)
                if k.startswith(base)
            ]
            return 200, nomes, "json"
        if partes[:2] == ["object", "sign"] and metodo == "POST" and len(partes) == 3:
            bucket, req = partes[2], json.loads(corpo)
            itens = [
                {"error": None, "path": p, "signedURL": f"/object/sign/{bucket}/{p}?token=t"} if f"{bucket}/{p}" in self.storage
                else {"error": "Object not found", "path": p, "signedURL": None}
                for p in req["paths"]
            ]  # fmt: skip
            return 200, itens, "json"
        if partes[:2] == ["object", "sign"] and metodo == "GET":
            dados = self.storage.get(unquote("/".join(partes[2:])))
            return (200, dados, "image/jpeg") if dados is not None else (404, {"error": "not found"}, "json")
        if partes[0] == "object" and metodo == "DELETE" and len(partes) == 2:
            bucket, req = partes[1], json.loads(corpo)
            if not ator["admin"]:
                return 200, [], "json"
            for p in req.get("prefixes", []):
                self.storage.pop(f"{bucket}/{p}", None)
            return 200, [{"name": p} for p in req.get("prefixes", [])], "json"
        if partes[0] == "object" and metodo in ("POST", "PUT") and len(partes) >= 3:
            bucket, caminho_obj = partes[1], unquote("/".join(partes[2:]))
            pasta = caminho_obj.split("/")[0]
            if not ator["admin"] and pasta != ator["filial_id"]:
                return (
                    403,
                    {
                        "statusCode": "403",
                        "error": "Unauthorized",
                        "message": "new row violates row-level security policy",
                    },
                    "json",
                )
            self.storage[f"{bucket}/{caminho_obj}"] = _extrair_arquivo(corpo, content_type)
            return 200, {"Key": f"{bucket}/{caminho_obj}", "Id": str(uuid.uuid4())}, "json"
        return 404, {"error": f"storage: {metodo} {caminho}"}, "json"

    # ---------------------------------------------------------------- servidor
    def start(self, port: int = 0) -> FakeSupabase:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_: Any) -> None:  # silencioso
                pass

            def _responder(
                self, status: int, corpo: Any, extra: dict[str, str] | None = None, tipo: str = "json"
            ) -> None:
                dados = b"" if corpo is None else corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json" if tipo == "json" else tipo)
                self.send_header("Content-Length", str(len(dados)))
                self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
                self.send_header("Access-Control-Allow-Credentials", "true")
                self.send_header("Access-Control-Expose-Headers", "Content-Range")
                for k, v in (extra or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(dados)

            def _tratar(self, metodo: str) -> None:
                url = urlparse(self.path)
                tamanho = int(self.headers.get("Content-Length") or 0)
                bruto = self.rfile.read(tamanho) if tamanho else b""
                params = parse_qs(url.query, keep_blank_values=True)
                with fake.lock:
                    fake.log.append(f"{metodo} {url.path}?{url.query[:100]}")
                    try:
                        if url.path == "/__log":
                            return self._responder(200, fake.log[-300:])
                        if url.path.startswith("/auth/v1/"):
                            corpo = json.loads(bruto) if bruto else {}
                            status, resp = fake.auth(
                                metodo, url.path.removeprefix("/auth/v1/"), params, corpo, self.headers
                            )
                            return self._responder(status, resp)
                        if url.path.startswith("/rest/v1/rpc/"):
                            resp = fake.rpc(url.path.rsplit("/", 1)[1], json.loads(bruto or b"{}"), self.headers)
                            return self._responder(200, resp)
                        if url.path.startswith("/rest/v1/"):
                            corpo = json.loads(bruto) if bruto else None
                            status, resp, extra = fake.rest(
                                metodo, url.path.removeprefix("/rest/v1/"), params, corpo, self.headers
                            )
                            return self._responder(status, resp, extra)
                        if url.path.startswith("/storage/v1/"):
                            status, resp, tipo = fake.storage_req(
                                metodo,
                                url.path.removeprefix("/storage/v1/"),
                                bruto,
                                self.headers.get("Content-Type", ""),
                                self.headers,
                            )
                            return self._responder(status, resp, tipo=tipo)
                        self._responder(404, {"message": f"fake: rota não tratada {metodo} {url.path}"})
                    except Erro as e:
                        self._responder(e.status, e.payload)

            def do_GET(self) -> None:
                self._tratar("GET")

            def do_POST(self) -> None:
                self._tratar("POST")

            def do_PUT(self) -> None:
                self._tratar("PUT")

            def do_PATCH(self) -> None:
                self._tratar("PATCH")

            def do_DELETE(self) -> None:
                self._tratar("DELETE")

            def do_OPTIONS(self) -> None:
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
                self.send_header(
                    "Access-Control-Allow-Headers", self.headers.get("Access-Control-Request-Headers") or "*"
                )
                self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
                self.send_header("Content-Length", "0")
                self.end_headers()

        self._server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self._server.daemon_threads = True
        self.port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()


def _extrair_arquivo(corpo: bytes, content_type: str) -> bytes:
    """O storage3 envia multipart/form-data; extrai os bytes do campo do arquivo."""
    m = re.search(r"boundary=([^;]+)", content_type)
    if not m:
        return corpo
    separador = b"--" + m.group(1).strip('"').encode()
    for parte in corpo.split(separador):
        if b'name="file"' in parte or b"filename=" in parte:
            _, _, resto = parte.partition(b"\r\n\r\n")
            return resto.removesuffix(b"\r\n")
    return corpo


def popular_demo(fake: FakeSupabase) -> dict[str, Any]:
    """Dados de demonstração usados pelos testes E2E."""
    sp, rj = fake.add_filial("São Paulo", "SP"), fake.add_filial("Rio de Janeiro", "RJ")
    admin = fake.add_user("admin@frotas.com", "senha-correta", "Ana Admin", "admin")
    sup_sp = fake.add_user("sup.sp@frotas.com", "senha-correta", "Carlos Supervisor", "supervisor", sp["id"])
    sup_rj = fake.add_user("sup.rj@frotas.com", "senha-correta", "Rita Supervisora", "supervisor", rj["id"])
    fake.add_user("sem.perfil@frotas.com", "senha-correta", "", perfil=False)
    hoje = datetime.now(UTC).date()
    v1 = fake.add_veiculo(
        sp["id"],
        "ABC1D23",
        marca="Fiat",
        modelo="Strada",
        ano=2022,
        km_atual=48200,
        proxima_revisao_km=49000,
        proxima_revisao_data=str(hoje.replace(year=hoje.year + 1)),
    )
    v2 = fake.add_veiculo(
        sp["id"],
        "XYZ9K88",
        marca="VW",
        modelo="Saveiro",
        ano=2020,
        km_atual=90000,
        proxima_revisao_km=89000,
        proxima_revisao_data=str(hoje.replace(year=hoje.year + 1)),
    )
    v3 = fake.add_veiculo(
        sp["id"],
        "JKL4E56",
        marca="Renault",
        modelo="Master",
        ano=2021,
        km_atual=12000,
        proxima_revisao_km=22000,
        proxima_revisao_data=str(hoje.replace(year=hoje.year + 1)),
    )
    v4 = fake.add_veiculo(
        rj["id"],
        "RJO1A11",
        marca="Ford",
        modelo="Ranger",
        km_atual=5000,
        proxima_revisao_km=15000,
        proxima_revisao_data=str(hoje.replace(year=hoje.year + 1)),
    )
    m1 = fake.add_motorista(sp["id"], "João da Silva", "52998224725")
    m2 = fake.add_motorista(sp["id"], "Maria Souza", "11144477735", whatsapp="5511988880002")
    m3 = fake.add_motorista(rj["id"], "Pedro Carioca", "39053344705", whatsapp="5521988880003")
    return {
        "sp": sp,
        "rj": rj,
        "admin": admin,
        "sup_sp": sup_sp,
        "sup_rj": sup_rj,
        "v": [v1, v2, v3, v4],
        "m": [m1, m2, m3],
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=54321)
    args = ap.parse_args()
    f = FakeSupabase().start(args.port)
    popular_demo(f)
    print(
        f"Supabase falso em {f.url} (admin@frotas.com / sup.sp@frotas.com / sup.rj@frotas.com, senha: senha-correta)",
        flush=True,
    )
    threading.Event().wait()
