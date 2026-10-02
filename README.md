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

Na VPS (Debian/Ubuntu), logado com um usuário que tenha `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/ezequiaslucas6-rgb/Frotas-ve-culos/claude/amazing-ptolemy-j5zi8z/deploy/instalar-vps.sh -o instalar-vps.sh
bash instalar-vps.sh                 # 1ª vez: instala o que faltar e cria /opt/frotas/.env
nano /opt/frotas/.env                # cole as 3 chaves do Supabase
bash /opt/frotas/deploy/instalar-vps.sh   # 2ª vez: sobe o app, Nginx/Apache, HTTPS e cron
```

O script (`deploy/instalar-vps.sh`) é idempotente — rodar de novo **atualiza** o app. Ele:
instala Docker se faltar · cria swap de 2 GB se a memória for curta para o build · baixa o código em `/opt/frotas` ·
gera o `CRON_SECRET` · sobe o container só em `127.0.0.1:3010` (o site que já existe na VPS não é afetado) · detecta o
servidor web (Nginx, Apache ou nenhum → instala Nginx) e cria o site de `frotas.209.50.240.59.sslip.io` · emite o HTTPS
(Let's Encrypt, renovação automática) · agenda os alertas diários.

Subdomínio: `*.sslip.io` aponta sozinho para o IP do nome, sem configurar DNS. Para usar outro domínio:
`DOMINIO=frotas.seudominio.com.br bash /opt/frotas/deploy/instalar-vps.sh` (com o registro A apontando para a VPS).

**Logs:** `sudo docker compose -f /opt/frotas/docker-compose.yml logs -f`.

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
