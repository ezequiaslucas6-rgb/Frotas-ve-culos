# Gestão de Frotas

Sistema multi-filial de gestão de frotas: **checklist fotográfico diário, semanal e mensal** (celular, só câmera), cadastro de motoristas (com
**CNH completa e imagens**) e veículos, **acesso do motorista pelo celular** com **lançamento de abastecimentos**,
**alertas de manutenção por KM e por período**, controle de custos (manutenção + combustível) e painel executivo.

**Stack:** Next.js 16 (App Router, Server Actions) · TypeScript · Supabase (Postgres + Auth + Storage + RLS) · Tailwind CSS v4 ·
roda na **sua VPS** em Docker, atrás do Nginx, num subdomínio com HTTPS.

> Versões anteriores no histórico do git: Streamlit (`9d374ad`) e a primeira web (`4009c36`).

---

## 1. Supabase (uma vez)
1. **SQL Editor** → execute os arquivos de `supabase/migrations/`, **um por vez e nesta ordem** (cada um numa execução
   separada — clique em *Run*, limpe o editor, cole o próximo):
   1. `20260101000000_init.sql`
   2. `20260102000000_rascunhos.sql`
   3. `20260103000000_papel_motorista.sql` (uma linha só; precisa rodar **sozinho**, antes do próximo)
   4. `20260103000100_motoristas_acesso.sql`
   5. `20260105000000_checklist_tipos.sql` (checklists diário/semanal/mensal)
   6. `20260106000000_checklist_motorista.sql` (o motorista faz o checklist dos próprios veículos)

   **Já tinha o sistema instalado?** Rode apenas o que ainda não rodou (nessa ordem, separados) e depois atualize o
   app na VPS. Quem já está com os itens 1–5 roda só o item 6.
2. Execute `supabase/seed.sql` (filiais de exemplo).
3. **Primeiro Administrador Geral (obrigatório).** Crie o usuário em *Authentication → Users → Add user* (marque
   *Auto Confirm User*) e vincule-o como admin:
   ```sql
   insert into public.profiles (id, nome, role, filial_id)
   select id, 'Administrador Geral', 'admin', null from auth.users where email = 'seu-email@empresa.com';
   ```
   Sem essa linha o login funciona, mas o app responde *"Seu usuário ainda não foi habilitado"*. O nome e a foto do
   Administrador Geral podem ser trocados depois, no próprio app, em **Meu perfil** (clique no seu nome no topo).
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
servidor web (Caddy, Nginx, Apache ou nenhum → instala Nginx) e cria o site de `frotas.209.50.240.59.sslip.io` · emite o HTTPS
(Caddy: automático; Nginx/Apache: Let's Encrypt via certbot) · agenda os alertas diários.

Subdomínio: `*.sslip.io` aponta sozinho para o IP do nome, sem configurar DNS. Para usar outro domínio:
`DOMINIO=frotas.seudominio.com.br bash /opt/frotas/deploy/instalar-vps.sh` (com o registro A apontando para a VPS).

**Logs:** `sudo docker compose -f /opt/frotas/docker-compose.yml logs -f`.

| Variável (`.env`) | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador e servidor (sempre sob RLS). Embutidas no build: mudou? rode `docker compose up -d --build` |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor**: criar supervisores, liberar/redefinir/remover o acesso de motoristas e o cron |
| `CRON_SECRET` | protege `/api/cron/alertas` |
| `FROTAS_PORTA` | porta local do container (padrão 3010) |

## 3. App Android (APK)

O app (`android/`) é o próprio sistema dentro de um WebView, ajustado ao celular: respeita a barra de status, o recorte
da câmera, a barra de navegação e o teclado; tira as fotos (checklist, CNH, cupom) com a câmera do aparelho; abre
WhatsApp, telefone e PDFs no app certo; o botão *voltar* volta as telas; mostra uma tela própria quando falta internet; e
mantém o login entre aberturas. Como ele carrega o site da VPS, **toda atualização do sistema chega ao app sem reinstalar**.

**Baixar:** a cada mudança em `android/`, o GitHub Actions (*App Android (APK)*) compila e publica em
**Releases → App Android** o arquivo `frotas.apk`
(`https://github.com/ezequiaslucas6-rgb/Frotas-ve-culos/releases/download/app-android/frotas.apk`). No celular: abra o
link, baixe, toque no arquivo e permita *instalar apps desta fonte*. Para gerar de novo (ex.: outro endereço), use
*Actions → App Android (APK) → Run workflow* (o botão aparece quando o workflow está na branch principal).

**Atualizar o APK por cima (opcional):** sem configuração, cada APK sai com uma chave de assinatura nova e, para trocar de
versão, é preciso desinstalar a anterior. Para atualizações por cima, crie uma chave **uma vez** e guarde-a com cuidado:
```bash
keytool -genkeypair -v -keystore frotas.jks -alias frotas -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 frotas.jks   # copie a saída
```
e cadastre em *Settings → Secrets and variables → Actions*: `ANDROID_KEYSTORE_BASE64` (a saída acima),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`frotas`) e `ANDROID_KEY_PASSWORD`. Nunca coloque o `.jks` no repositório.

## 4. Desenvolvimento
```bash
npm install
cp .env.example .env.local   # preencha
npm run dev                  # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
cd supabase/tests && npm ci && npm test   # migrations + RLS no Postgres embutido
```

---

## Visual

Tema **escuro por padrão** (grafite + azul **#007FD6**; ícones da marca em **#0097FF**), com alternância para **claro** — útil
no sol, no pátio. Login da marca **Rodar** com a paleta roxo → azul → verde mesclada em ondas. Trilho lateral de
ícones no desktop; no celular, barra inferior com o botão de câmera ao centro. Fonte *Plus Jakarta Sans* (servida pelo
próprio app, sem depender do Google). As cores de status (verde/âmbar/vermelho) foram validadas para contraste e
daltonismo nos dois temas e sempre aparecem com ícone + texto.

## Modelo de acesso (RBAC + RLS)

| | Admin Geral | Supervisor | Motorista |
|---|---|---|---|
| Filiais | CRUD de todas | lê somente a própria | lê a própria |
| Veículos | CRUD global | lê, cria e edita **da própria filial** | lê **só os veículos em que é o responsável** |
| Motoristas (e CNH) | CRUD global | lê, cria e edita da própria filial | lê só o próprio cadastro |
| Manutenções / custos | CRUD global | da própria filial | — |
| Checklists | CRUD global | lê e cria da própria filial (imutáveis) | faz nos próprios veículos, em seu nome; lê só os seus |
| Abastecimentos | todos; corrige e exclui | lê e lança da própria filial | lança nos próprios veículos; lê só os seus |
| Exclusões | sim | não (para desligar um motorista: status *Inativo*) | não |

O isolamento é garantido no banco: RLS em todas as tabelas, FKs compostas `(veiculo_id, filial_id)` e
`(motorista_id, filial_id)` que impedem referências entre filiais, `profiles` gravável só pelo Admin (nome e foto mudam
por uma função que altera só esses dois campos), Storage privado por pasta de filial e view com `security_invoker`. O
`src/proxy.ts` valida o login (assinatura do JWT) em toda requisição; cada página e Server Action exige o papel certo
(`requireSession` é fechado para o motorista por padrão, que só abre *Meu veículo*, *Checklists*, *Abastecimentos* e *Meu perfil*;
`requireAdmin` para as telas do admin) — e a RLS é a barreira final (testes em `supabase/tests/`).

## Acesso do motorista

1. Cadastre o motorista (com a **CNH**) e, na edição do veículo, escolha o **motorista responsável**.
2. Abra o motorista → **Acesso ao app** → *Gerar* → **Liberar acesso**. O login é o e-mail do cadastro; anote a senha
   provisória e repasse (ele pode trocá-la em *Meu perfil*). Supervisores liberam o acesso dos motoristas da própria filial.
3. No celular o motorista vê **Meu veículo** (placa, KM, próxima revisão, documento CRLV, consumo médio e alerta da CNH),
   o botão central da **câmera**, que abre o **checklist** (veículo e motorista já preenchidos), e *Registrar abastecimento*
   em *Meu veículo* e no *Histórico*.

Motorista com status *Inativo* perde o acesso na hora. *Remover acesso* apaga o login e mantém o histórico.

## Abastecimentos

Lançados pelo motorista (ou pelo supervisor): data, KM do hodômetro, combustível, litros, valor, tanque cheio/parcial,
posto e **foto do cupom**. O KM do veículo é atualizado automaticamente (nunca regride) e o app recusa KM menor que o
último registrado no mesmo dia. O **consumo (km/l)** usa o método tanque cheio a tanque cheio (parciais somam ao ciclo
seguinte). O painel passa a mostrar o **custo da frota = manutenção + combustível**.

## CNH

Seção própria no cadastro do motorista: nº de registro, categoria, validade, emissão, 1ª habilitação, UF, EAR e
observações, com **fotos de frente e verso** (ou o PDF da CNH digital). Situação pela validade: 🔴 vencida ·
🟡 vence em até 30 dias · 🟢 em dia — no painel (*CNH dos motoristas*), na lista de motoristas e no app do motorista.

## Desempenho

Trocar de tela não espera o servidor: os links do menu pré-carregam as telas principais **com os dados** e telas já
abertas voltam do cache do navegador (ambos valem 30 s; qualquer gravação descarta o cache na hora). Filtros, busca e
paginação atualizam sem recarregar a página, com barra de progresso no topo.

No servidor, cada tela faz o mínimo de idas ao Supabase: o login é validado uma única vez por requisição (no proxy) e
repassado às páginas; o perfil (nome/papel/filial) fica 60 s em memória; consultas independentes rodam em paralelo; as
URLs assinadas das imagens são reaproveitadas por 5 h (o navegador usa o próprio cache em vez de baixar de novo); a lista
de veículos usa **miniaturas** (~30 KB em vez de ~250 KB) geradas no upload.

Medido com 80 ms de distância simulada entre VPS e Supabase: troca de tela de **~430 ms → ~10 ms**; filtro/busca de
**~430 ms → ~100–180 ms**; chamadas ao Supabase numa sessão típica **−67%**.

**Dica (opcional):** em projetos com a chave de assinatura JWT legada, o proxy ainda consulta o Auth do Supabase uma vez
por tela. Com as [chaves de assinatura assimétricas](https://supabase.com/docs/guides/auth/signing-keys) o login é
validado na própria VPS, sem essa ida. O `deploy/diagnostico.sh` mostra qual é o seu caso e a distância VPS → Supabase
(o ideal é o projeto Supabase na mesma região da VPS).

## Checklist diário, semanal e mensal
| Tipo | Fotos (padrão) |
|---|---|
| **Diário** | Exterior (frente, traseira, 2 laterais) · **Pneus** (os 4) · **Retrovisores** (os 2) · **Motor e fluidos** (óleo, fluido de freio, água do arrefecimento) · Cabine (painel com KM, **bancos**) — 15 fotos |
| **Semanal** | Diário + luzes, para-brisa, estepe, carroceria/porta-malas — 19 fotos |
| **Mensal** | Semanal + compartimento do motor, equipamentos obrigatórios — 21 fotos |

Em todos os tipos: **"O veículo tem algum vazamento ou avaria?" Sim/Não** — no "Sim" a foto (com Atenção/Avaria e
descrição) passa a ser obrigatória. O Administrador Geral ajusta o que cada tipo exige em **Checklists → Modelos**.

Só câmera: não existe opção de galeria (no APK o campo abre a câmera direto) e fotos antigas são recusadas.
**Compressão no aparelho** (fotos de 3–12 MB viram ~300 KB), upload direto ao Storage item a item com novas tentativas,
**pins de avaria tocando na foto**, status geral em tempo real e rascunho que sobrevive ao recarregar a página. O envio
final é uma RPC atômica (`salvar_checklist`) que confere as fotos com o modelo do tipo e grava checklist + fotos + KM
numa transação.

## Alertas de manutenção
| Nível | Regra (vale o pior entre KM e período) |
|---|---|
| **vencido** | KM atual ≥ KM da revisão **ou** data da revisão ≤ hoje |
| **próximo** | faltam ≤ 1.000 km **ou** ≤ 15 dias |

Semáforo: 🔴 Manutenção/Avaria · 🟡 Atenção · 🟢 Liberado (detalhes em `src/lib/maintenance/alerts.ts`).

## Limites conhecidos
- Fotos de checklists abandonados, cupons trocados antes do envio e fotos de perfil antigas ficam no Storage
  (usuários não excluem arquivos); um job de limpeza pode vir depois.
- O motorista faz checklist só dos veículos em que é o responsável; o supervisor/admin, de qualquer veículo da filial.
- Mudar um modelo vale para os próximos checklists; um rascunho em andamento usa o modelo da hora em que a
  tela foi aberta (se o modelo mudar no meio, o envio avisa qual foto falta).
- Os caches de perfil e de URLs assinadas ficam na memória do container (um único processo, como na VPS); ao reiniciar,
  recomeçam vazios. Fotos de veículos enviadas antes desta versão não têm miniatura: a lista usa a foto completa até
  ela ser trocada.
- Sem fila offline: sem sinal, o envio falha com aviso e o rascunho preserva o que já subiu.
- A tabela `checklist_rascunhos` (migration 20260102) foi criada para a versão Streamlit; a web guarda o rascunho no
  próprio aparelho e não a usa — pode ficar como está.
