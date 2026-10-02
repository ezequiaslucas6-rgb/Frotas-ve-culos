# Gestão de Frotas

Sistema multi-filial de gestão de frotas: **checklist fotográfico de 14 etapas** (mobile/WebView), cadastro de
motoristas e veículos, **alertas de manutenção por KM e por período**, controle de custos e painel executivo.

**Stack:** Next.js 16 (App Router, RSC, Server Actions) · TypeScript · Supabase (Postgres + Auth + Storage + RLS) ·
Tailwind CSS v4 + componentes no padrão shadcn/ui · Lucide · Deploy na Vercel.

---

## Como rodar

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com).
2. **SQL Editor** → execute `supabase/migrations/20260101000000_init.sql` (tabelas, enums, FKs, RLS, view, RPC e Storage).
3. Execute `supabase/seed.sql` (filiais de exemplo) e siga as instruções do arquivo para criar o **primeiro Administrador Geral**.
4. **Authentication → Providers → Email**: desative *"Allow new users to sign up"*. Os usuários são criados pelo Admin
   dentro do sistema (menu *Supervisores*); cadastro aberto não deve existir.

### 2. Variáveis de ambiente
```bash
cp .env.example .env.local   # preencha com as chaves do projeto (Project Settings > API)
```
| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser e servidor (sempre sob RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor**: criar supervisores e cron de alertas |
| `CRON_SECRET` | protege `/api/cron/alertas` (a Vercel envia `Authorization: Bearer <CRON_SECRET>`) |

### 3. Desenvolvimento
```bash
npm install
npm run dev          # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
```

### 4. Deploy (Vercel)
Importe o repositório, configure as 4 variáveis acima e publique. O `vercel.json` já agenda o cron diário
(09:00 UTC) que recalcula os alertas de revisão de toda a frota.

> **Next.js 14/15:** o projeto usa Next 16, onde o antigo *middleware* se chama **proxy** (`src/proxy.ts`, função `proxy`).
> Para rodar em Next 14/15, renomeie para `src/middleware.ts` e exporte a função como `middleware` — o conteúdo é o mesmo.

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
- **FKs compostas** `(veiculo_id, filial_id)` / `(motorista_id, filial_id)`: impossível referenciar veículo ou motorista de outra filial,
  mesmo com um `filial_id` válido.
- `profiles` só é gravável pelo Admin (supervisor não consegue elevar `role` nem trocar de filial) e `anon` não acessa nada.
- **Storage** privado, caminho `<filial_id>/...`, com políticas por pasta; leitura apenas via URL assinada.
- A view `vw_veiculos_painel` usa `security_invoker = true` (herda a RLS de quem consulta).
- O `proxy.ts` revalida o JWT (`getUser()`), redireciona quem não está logado e barra `/filiais` e `/supervisores` para não-admins;
  páginas e Server Actions revalidam (`requireSession` / `requireAdmin`). Defesa em profundidade — a RLS é a barreira final.

---

## Checklist de 14 etapas (`src/components/checklist`)

Wizard mobile-first: **identificação → 14 fotos → revisão → envio**.

- **Câmera nativa** (`<input capture="environment">`) com opção de galeria; botões grandes e barra de ações fixa para o polegar.
- **Compressão no cliente** (canvas, 1600 px, JPEG 0,8): fotos de 1–12 MB caem para ~300 KB antes do upload.
- **Upload direto ao Storage**, foto a foto, com 3 tentativas e "Reenviar". O payload da Server Action leva só metadados
  (sem estourar o limite de corpo da Vercel).
- **Marcadores em tempo real:** por etapa, *Conforme / Atenção / Avaria* + observação obrigatória quando não conforme +
  pins de avaria tocados sobre a foto. O topo mostra barra de progresso colorida, contadores e o status geral ao vivo.
- **Rascunho resiliente:** o WebView costuma recarregar a página ao abrir a câmera. O progresso (metadados) fica em
  `localStorage` e as fotos já estão no Storage; ao reabrir, o app oferece *Continuar* (previews via URL assinada).
- KM do hodômetro exigido na etapa *Painel* (nunca menor que o último registrado).

**Server Action `salvarChecklist`** (`src/actions/checklists.ts`): valida com zod → confere veículo/motorista (RLS) e filial →
confere o caminho e a **existência** de cada foto no Storage → chama a RPC atômica `salvar_checklist`
(checklist + 14 fotos + KM, numa transação; o status geral é derivado no banco) → recalcula os alertas do veículo.

## Alertas de manutenção (`src/lib/maintenance`)

Cada veículo tem um plano (`proxima_revisao_km` / `proxima_revisao_data`, derivado dos intervalos configurados).

| Nível | Regra (vale o pior entre KM e período) |
|---|---|
| **vencido** | KM atual ≥ KM da revisão **ou** data da revisão ≤ hoje |
| **próximo** | faltam ≤ 1.000 km **ou** ≤ 15 dias |
| **ok** | dentro do plano |

Semáforo do painel: 🔴 **Manutenção/Avaria** (checklist crítico não tratado ou revisão vencida) · 🟡 **Atenção**
(checklist em atenção não tratado ou revisão próxima) · 🟢 **Liberado**. "Tratado" = há manutenção *corretiva* na data do
checklist ou depois. Registrar uma *preventiva* agenda a próxima revisão (KM + intervalo, data + intervalo).

Como o prazo vence com o passar do tempo (sem nenhuma escrita), o painel **calcula ao ler**; o cron diário e o botão
*Atualizar alertas* persistem `manutencoes.status_alerta`. As regras são funções puras (`alerts.ts`) cobertas por testes.

---

## Estrutura

```
supabase/
  migrations/20260101000000_init.sql   # schema, FKs, RLS, view, RPC, Storage
  seed.sql                             # filiais + bootstrap do 1º admin
  tests/                               # testes de RLS (PGlite) + shim da plataforma
src/
  proxy.ts                             # auth + role por rota (middleware no Next 14/15)
  app/
    (auth)/login/                      # login
    (app)/                             # área autenticada (layout com sidebar/bottom-nav)
      dashboard/ checklists/ veiculos/ motoristas/ manutencoes/ filiais/ supervisores/
    api/cron/alertas/route.ts          # recalcula alertas (Bearer CRON_SECRET)
    manifest.ts                        # PWA
  actions/                             # Server Actions (auth, checklists, veiculos, motoristas, manutencoes, filiais, supervisores, alertas)
  components/
    checklist/                         # wizard, etapa de captura, rascunho
    ui/                                # componentes base (shadcn-style), upload, máscaras, badges
    layout/ filial-filter.tsx pagination.tsx
  lib/
    supabase/ (client, server, admin, session)   auth.ts   schemas.ts (zod)
    maintenance/ (alerts, sync, describe)        checklist/etapas.ts
    validators/documentos.ts (CPF, CNH, placa, WhatsApp)   image/compress.ts
  types/database.ts                    # tipos do banco (formato `supabase gen types`)
```

## Testes

```bash
npm test   # 45 testes: validadores, regras de alerta, etapas e isolamento RLS
```
Os testes de RLS executam a **migration real** num Postgres embutido (PGlite) e provam, por role, que um supervisor
não lê/escreve/exclui dados de outra filial (tabelas, RPC, view e Storage), que as FKs compostas barram referências cruzadas
e que a RPC é atômica.

## Notas e limites conhecidos

- **Arquivos órfãos:** fotos de um checklist abandonado ficam no Storage (supervisores não têm permissão de exclusão).
  Um job de limpeza (objetos sem `checklist_fotos` há > 48 h) pode ser adicionado depois.
- **Offline:** há manifest/ícones para instalar como PWA, mas não há service worker nem fila offline de envio.
- **Tipos:** `src/types/database.ts` é mantido à mão; após mudar o schema, regenere com
  `npx supabase gen types typescript --project-id <id> > src/types/database.ts`.
- **Unicidade da placa é global** (uma placa existe uma vez no país); tentar cadastrar placa de outra filial retorna
  "já cadastrada" sem revelar a filial.
