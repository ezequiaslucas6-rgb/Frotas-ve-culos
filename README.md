# Gestão de Frotas

Sistema multi-filial de gestão de frotas: **checklist fotográfico de 14 etapas** (celular), cadastro de motoristas e
veículos, **alertas de manutenção por KM e por período**, controle de custos e painel executivo.

**Stack:** Next.js 16 (App Router, Server Actions) · TypeScript · Supabase (Postgres + Auth + Storage + RLS) · Tailwind CSS v4 ·
roda na **sua VPS** em Docker, atrás do Nginx, num subdomínio com HTTPS.

> Versões anteriores no histórico do git: Streamlit (`9d374ad`) e a primeira web (`4009c36`).

---

## 1. Supabase (uma vez)
1. **SQL Editor** → execute, nesta ordem, `supabase/migrations/20260101000000_init.sql` e
   `supabase/migrations/20260102000000_rascunhos.sql`.
2. Execute `supabase/seed.sql` (filiais de exemplo).
3. **Primeiro Administrador Geral (obrigatório).** Crie o usuário em *Authentication → Users → Add user* (marque
   *Auto Confirm User*) e vincule-o como admin:
   ```sql
   insert into public.profiles (id, nome, role, filial_id)
   select id, 'Administrador Geral', 'admin', null from auth.users where email = 'seu-email@empresa.com';
   ```
   Sem essa linha o login funciona, mas o app responde *"Seu usuário ainda não foi habilitado"*.
4. *Authentication → Providers → Email*: desative *"Allow new users to sign up"* (usuários são criados pelo Admin no app).

## 2. Publicar na VPS (Linux)

Pré-requisitos no servidor: **Docker** (com o plugin `compose`), **Nginx** e **Certbot**. O site que já existe na VPS não
é afetado: o app escuta só em `127.0.0.1:3010` e o Nginx o publica no subdomínio.

```bash
# 1) DNS: crie um registro A  frotas.SEUDOMINIO.com.br -> IP da VPS

# 2) código
sudo mkdir -p /opt/frotas && sudo chown $USER /opt/frotas
git clone <url-do-repositório> /opt/frotas && cd /opt/frotas
cp .env.example .env && nano .env          # chaves do Supabase + CRON_SECRET (openssl rand -hex 32)

# 3) app
docker compose up -d --build
curl -I http://127.0.0.1:3010/login        # deve responder 200

# 4) Nginx + HTTPS
sudo cp deploy/nginx/frotas.conf /etc/nginx/sites-available/frotas.conf
sudo sed -i 's/frotas.SEUDOMINIO.com.br/frotas.seudominio.com.br/g' /etc/nginx/sites-available/frotas.conf
sudo ln -s /etc/nginx/sites-available/frotas.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d frotas.seudominio.com.br

# 5) alertas diários de revisão
crontab -e                                  # cole a linha de deploy/crontab.txt (com seu CRON_SECRET e domínio)
```

**Atualizar depois:** `cd /opt/frotas && ./deploy/atualizar.sh` (puxa o código, reconstrói e reinicia).
**Logs:** `docker compose logs -f frotas`.

| Variável (`.env`) | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador e servidor (sempre sob RLS). Embutidas no build: mudou? rode `docker compose up -d --build` |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor**: criar supervisores e o cron |
| `CRON_SECRET` | protege `/api/cron/alertas` |
| `FROTAS_PORTA` | porta local do container (padrão 3010) |

## 3. Desenvolvimento
```bash
npm install
cp .env.example .env.local   # preencha
npm run dev                  # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
cd supabase/tests && npm ci && npm test   # migrations + RLS no Postgres embutido
```

---

## Visual

Tema **escuro por padrão** (grafite + roxo), com alternância para **claro** — útil no sol, no pátio. Trilho lateral de
ícones no desktop; no celular, barra inferior com o botão de câmera ao centro. Fonte *Plus Jakarta Sans* (servida pelo
próprio app, sem depender do Google). As cores de status (verde/âmbar/vermelho) foram validadas para contraste e
daltonismo nos dois temas e sempre aparecem com ícone + texto.

## Modelo de acesso (RBAC + RLS)

| | Admin Geral | Supervisor |
|---|---|---|
| Filiais | CRUD de todas | lê somente a própria |
| Veículos / Motoristas / Manutenções | CRUD global | lê, cria e edita **somente da própria filial** |
| Checklists | CRUD global | lê e cria da própria filial (imutáveis após o envio) |
| Exclusões | sim | não (para desligar um motorista: status *Inativo*) |

O isolamento é garantido no banco: RLS em todas as tabelas, FKs compostas `(veiculo_id, filial_id)` que impedem referências
entre filiais, `profiles` gravável só pelo Admin, Storage privado por pasta de filial e view com `security_invoker`. O
`src/proxy.ts` revalida a sessão e barra rotas de admin; páginas e Server Actions revalidam — a RLS é a barreira final.

## Checklist de 14 etapas
Câmera nativa do celular, **compressão no aparelho** (fotos de 3–12 MB viram ~300 KB), upload direto ao Storage etapa a etapa
com novas tentativas, **pins de avaria tocando na foto**, status geral em tempo real e rascunho que sobrevive ao recarregar a
página. O envio final é uma RPC atômica (`salvar_checklist`) que grava checklist + 14 fotos + KM numa transação.

## Alertas de manutenção
| Nível | Regra (vale o pior entre KM e período) |
|---|---|
| **vencido** | KM atual ≥ KM da revisão **ou** data da revisão ≤ hoje |
| **próximo** | faltam ≤ 1.000 km **ou** ≤ 15 dias |

Semáforo: 🔴 Manutenção/Avaria · 🟡 Atenção · 🟢 Liberado (detalhes em `src/lib/maintenance/alerts.ts`).

## Limites conhecidos
- Fotos de checklists abandonados ficam no Storage (supervisores não excluem arquivos); um job de limpeza pode vir depois.
- Sem fila offline: sem sinal, o envio falha com aviso e o rascunho preserva o que já subiu.
- A tabela `checklist_rascunhos` (migration 20260102) foi criada para a versão Streamlit; a web guarda o rascunho no
  próprio aparelho e não a usa — pode ficar como está.
