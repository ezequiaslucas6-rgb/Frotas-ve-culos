# Gestão de Frotas

Sistema multi-filial de gestão de frotas: **checklist fotográfico de 14 etapas** (celular), cadastro de motoristas e
veículos, **alertas de manutenção por KM e por período**, controle de custos e painel executivo.

**Stack:** Streamlit (Python) · Supabase (Postgres + Auth + Storage + RLS) · Pillow · deploy gratuito no
**Streamlit Community Cloud**.

> A primeira versão (Next.js + Vercel) continua no histórico do git: `git show 4009c36`.

---

## Como rodar

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com).
2. **SQL Editor** → execute, nesta ordem, `supabase/migrations/20260101000000_init.sql` e
   `supabase/migrations/20260102000000_rascunhos.sql` (tabelas, enums, FKs, RLS, view, RPC, Storage, rascunhos).
3. Execute `supabase/seed.sql` (filiais de exemplo) e siga as instruções do arquivo para criar o **primeiro
   Administrador Geral**.
4. **Authentication → Providers → Email**: desative *"Allow new users to sign up"*. Os usuários são criados pelo Admin
   dentro do sistema (menu *Supervisores*); cadastro aberto não deve existir.

### 2. Segredos
```bash
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # preencha (Project Settings > API)
```
| Chave | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | todas as consultas do usuário (sempre sob RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor**: criar/excluir supervisores e o job de alertas. Os Secrets do Streamlit nunca vão ao navegador |

### 3. Rodar localmente
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
streamlit run streamlit_app.py
```

### 4. Publicar no Streamlit Community Cloud (gratuito)
1. Suba o repositório no GitHub.
2. Em [share.streamlit.io](https://share.streamlit.io) → **Create app** → escolha o repositório/branch e o arquivo
   principal **`streamlit_app.py`** (o `requirements.txt` da raiz é instalado sozinho; use Python 3.11+ em *Advanced settings*).
3. Em **Advanced settings → Secrets**, cole o conteúdo do seu `secrets.toml`.
4. **Deploy.** No celular, abra a URL e use *Adicionar à tela inicial* para ter um atalho.

**Alertas diários (substitui o cron):** o workflow `.github/workflows/alertas.yml` roda todo dia às 09:00 (Brasília) e
recalcula os alertas de toda a frota. No GitHub: *Settings → Secrets and variables → Actions* e crie
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

---

## Modelo de acesso (RBAC + RLS)

| | Admin Geral | Supervisor |
|---|---|---|
| Filiais | CRUD de todas | lê somente a própria |
| Veículos / Motoristas / Manutenções | CRUD global | lê, cria e edita **somente da própria filial** |
| Checklists | CRUD global | lê e cria da própria filial (imutáveis após o envio) |
| Exclusões | sim | não (para desligar um motorista: status *Inativo*) |
| Supervisores / perfis | cria, vincula a uma filial, exclui | lê só colegas da própria filial |

O isolamento **não depende do código da aplicação**; ele é garantido no banco:

- **RLS em todas as tabelas** usando `private.is_admin()` / `private.my_filial_id()` (`SECURITY DEFINER`, schema não exposto).
- **FKs compostas** `(veiculo_id, filial_id)` / `(motorista_id, filial_id)`: impossível referenciar veículo ou motorista de
  outra filial, mesmo com um `filial_id` válido.
- `profiles` só é gravável pelo Admin (supervisor não eleva `role` nem troca de filial) e `anon` não acessa nada.
- **Storage** privado, caminho `<filial_id>/...`, com políticas por pasta; leitura apenas via URL assinada.
- A view `vw_veiculos_painel` usa `security_invoker = true` (herda a RLS de quem consulta).

No Streamlit, **cada sessão de navegador tem o seu próprio cliente Supabase autenticado com o JWT do usuário**
(`frotas/infra/auth.py`), então toda consulta passa pela RLS. A `service role` só é usada em operações administrativas
explícitas (`cliente_admin()`), sempre depois de `sessao.exigir_admin()`. A navegação por papel e os guards das páginas
são defesa em profundidade — a RLS é a barreira final.

**Sessão e cookie.** O Streamlit mantém o estado no servidor; se o celular perde a conexão a sessão some. Para não
obrigar novo login, o *refresh token* fica num cookie (`SameSite=Strict`, `Secure` em https, 14 dias). Ele **gira a cada
renovação** (uso único) e *Sair* o revoga no Supabase. Se preferir não persistir login, remova `_agendar_cookie` em
`frotas/ui/sessao.py`.

---

## Checklist de 14 etapas (`frotas/paginas/checklist_novo.py`)

Fluxo: **identificação → 14 fotos → revisão → envio**.

- **Câmera:** aba *Tirar foto / escolher arquivo* (no celular abre a **câmera traseira nativa**) e aba *Webcam*.
- **Compressão no servidor** (Pillow: corrige a orientação EXIF, 1600 px, JPEG 80): fotos de 3–12 MB caem para ~300 KB.
- **Upload etapa a etapa** ao Storage: uma queda de conexão não perde as fotos já enviadas. O envio final leva só
  metadados, numa **RPC atômica** (`salvar_checklist`: checklist + 14 fotos + KM do veículo, numa transação).
- **Marcadores em tempo real:** por etapa, *Conforme / Atenção / Avaria* + observação obrigatória quando não conforme +
  **pins numerados clicáveis sobre a foto** (o primeiro pin já marca *Atenção*). O topo mostra a barra de progresso
  colorida, os contadores e o status geral ao vivo.
- **Rascunho no banco** (`checklist_rascunhos`): se a sessão cair, ao voltar o app oferece *Continuar de onde parou*.
- KM do hodômetro exigido na etapa *Painel* (nunca menor que o último registrado).

`frotas/services/checklists.py::salvar_checklist` valida o payload, confere veículo/motorista (RLS) e a filial, confere o
caminho **e a existência** de cada foto no Storage, chama a RPC e recalcula os alertas do veículo.

## Alertas de manutenção (`frotas/domain/alertas.py`)

Cada veículo tem um plano (`proxima_revisao_km` / `proxima_revisao_data`, derivado dos intervalos configurados).

| Nível | Regra (vale o pior entre KM e período) |
|---|---|
| **vencido** | KM atual ≥ KM da revisão **ou** data da revisão ≤ hoje |
| **próximo** | faltam ≤ 1.000 km **ou** ≤ 15 dias |
| **ok** | dentro do plano |

Semáforo do painel: 🔴 **Manutenção/Avaria** (checklist crítico não tratado ou revisão vencida) · 🟡 **Atenção**
(checklist em atenção não tratado ou revisão próxima) · 🟢 **Liberado**. "Tratado" = há manutenção *corretiva* na data do
checklist ou depois. Registrar uma *preventiva* agenda a próxima revisão (KM + intervalo, data + intervalo).

O painel **calcula ao ler** (o prazo vence com o tempo, sem escrita); o job diário e o botão *Atualizar alertas*
persistem `manutencoes.status_alerta`. As regras são funções puras com testes.

---

## Estrutura

```
streamlit_app.py                  # entrypoint: sessão, login, navegação por papel
frotas/
  domain/                         # regras puras: alertas, etapas, CPF/CNH/placa/WhatsApp, imagens (Pillow), datas
  infra/                          # config, cliente Supabase (por sessão), auth, storage, erros
  services/                       # casos de uso: checklists, manutenções, veículos, motoristas, filiais, ...
  paginas/                        # telas Streamlit (dashboard, checklist_novo, veiculos, ...)
  ui/                             # estilo, rotas internas, sessão/cookie, componentes
scripts/sincronizar_alertas.py    # job diário (GitHub Actions)
supabase/
  migrations/                     # schema, RLS, view, RPC, Storage, rascunhos
  seed.sql
  tests/                          # testes de RLS (Postgres embutido) — Node, isolado
tests/                            # pytest: domínio, serviços (supabase-py real x Supabase falso), E2E (Playwright)
.streamlit/config.toml            # tema, limites e segurança
```

## Testes

```bash
pip install -r requirements-dev.txt
pytest                            # domínio + serviços (≈110 testes)

playwright install chromium
pytest -m e2e                     # E2E no navegador: login, cookie, wizard de 14 fotos, rascunho, admin

cd supabase/tests && npm ci && npm test   # migrations + RLS no Postgres embutido (PGlite)
```

- Os testes de **serviços** rodam o `supabase-py` real por HTTP contra um Supabase falso em memória
  (`tests/fake_supabase.py`), incluindo escopo por filial, upsert, RPC e Storage.
- O **E2E** sobe o Streamlit de verdade + o Supabase falso e dirige o Chromium (câmera simulada).
- Os testes de **RLS** executam as migrations reais e provam, por role, que um supervisor não lê/escreve/exclui dados de
  outra filial (tabelas, RPC, view, Storage e rascunhos).

## Notas e limites conhecidos

- **Plano gratuito do Streamlit Cloud:** o app "dorme" após inatividade e acorda com um clique (alguns segundos). O job de
  alertas atualiza o banco, mas não acorda o app.
- **Câmera:** o `st.camera_input` (webcam) usa a câmera padrão do navegador (no celular costuma ser a frontal). Para a
  câmera traseira use a aba *Tirar foto / escolher arquivo*.
- **Fotos órfãs:** fotos de um checklist abandonado ficam no Storage (supervisores não têm permissão de exclusão). Um job
  de limpeza (objetos sem `checklist_fotos` há > 48 h) pode ser adicionado depois.
- **Offline:** não há fila offline de envio; sem sinal, o app avisa e o rascunho preserva o que já subiu.
- **Placa única globalmente** (uma placa existe uma vez no país): cadastrar a placa de outra filial retorna "já cadastrada"
  sem revelar a filial.
