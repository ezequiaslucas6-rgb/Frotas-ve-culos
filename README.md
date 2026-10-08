# Rodar — Gestão de Frotas

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
   7. `20260107000000_avaria_bloqueio.sql` (avaria crítica abre manutenção e deixa o veículo não liberado)
   8. `20260108000000_cupom_abastecimento.sql` (valor total, desconto e leitura do cupom no abastecimento)
   9. `20260109000000_rotina_checklist.sql` (horário de Pimenta Bueno, decisão diária do supervisor, semanal
      obrigatório, foto da carcaça dos retrovisores)
   10. `20260110000000_motorista_dados_opcionais.sql` (CPF, WhatsApp e CNH do motorista opcionais no banco, para a
      fase de testes)

   **Já tinha o sistema instalado?** Rode apenas o que ainda não rodou (nessa ordem, separados) e depois atualize o
   app na VPS. Quem já está com os itens 1–9 roda só o item 10.
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

### Atualizações automáticas
Depois da primeira instalação, ninguém precisa atualizar nada à mão:
1. **VPS:** a cada 10 minutos (`deploy/auto-atualizar.sh`, no cron do root) ela confere o GitHub e, se há versão nova,
   constrói e troca o container (o app anterior fica no ar até a nova estar pronta). Histórico em
   `/opt/frotas/atualizacao.log`. **Versão com migration de banco nova não é publicada sozinha**: o aviso fica em
   `/opt/frotas/ATUALIZACAO_PENDENTE.txt` com a lista do que rodar no SQL Editor; depois rode
   `bash /opt/frotas/deploy/atualizar.sh`. Para desligar: `AUTO_ATUALIZAR=0 bash /opt/frotas/deploy/instalar-vps.sh`.
2. **Celulares e navegadores:** o app confere a versão do servidor ao voltar para a tela, ao recuperar a internet e a
   cada 10 minutos; se mudou, **recarrega sozinho**. Em tela de formulário (lançamento, checklist, cadastro) ele só
   mostra *"Nova versão do Rodar"* e atualiza ao sair dela, sem perder o que foi digitado.
3. **APK:** só muda quando a parte Android muda (raro). O próprio app confere a versão publicada no GitHub (a cada 6 h)
   e oferece **Atualizar**: baixa, confere o arquivo e abre o instalador do Android, que instala por cima. Na primeira
   vez o Android pede para permitir que o Rodar instale atualizações.

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
mantém o login entre aberturas. Como ele carrega o site da VPS, **toda atualização do sistema chega ao app sem reinstalar**
(ele recarrega sozinho ao voltar para a tela) e o próprio APK se atualiza pelo app quando a parte Android muda (veja
*Atualizações automáticas*).

**Baixar:** a cada mudança em `android/`, o GitHub Actions (*App Android (APK)*) compila e publica em
**Releases → App Android** o arquivo `frotas.apk`
(`https://github.com/ezequiaslucas6-rgb/Frotas-ve-culos/releases/download/app-android/frotas.apk`). No celular: abra o
link, baixe, toque no arquivo e permita *instalar apps desta fonte*. Para gerar de novo (ex.: outro endereço), use
*Actions → App Android (APK) → Run workflow* (o botão aparece quando o workflow está na branch principal).

**Atualizar o APK por cima (chave fixa):** sem configuração, cada APK sai com uma chave de assinatura diferente e, para
trocar de versão, é preciso desinstalar a anterior. Para que as versões novas instalem **por cima**, crie a chave fixa
**uma vez** na VPS:
```bash
bash /opt/frotas/deploy/gerar-chave-apk.sh            # cria ~/rodar-chave-apk e mostra os 4 valores
bash /opt/frotas/deploy/gerar-chave-apk.sh --mostrar  # mostra os valores de novo
```
Cadastre os 4 valores em *Settings → Secrets and variables → Actions → New repository secret*
(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) e gere o APK de novo
(*Actions → App Android (APK) → Run workflow*). O log do passo *Conferir assinatura* mostra a impressão digital da chave
usada. Nos celulares, desinstale o app antigo **uma última vez**; daí em diante, cada versão instala por cima.
Guarde uma cópia de `~/rodar-chave-apk` fora da VPS e **nunca** coloque a chave no repositório (ele é público).

**Lembretes no celular.** O APK avisa, no horário de Pimenta Bueno (America/Porto_Velho):
- **08:00, motorista:** o checklist do dia de cada veículo dele (o diário até as 08:30; no sábado e no domingo, o
  semanal obrigatório; ou que o veículo está *não liberado* por falta do semanal). Quem já fez não recebe nada.
- **08:30, supervisor e Administrador Geral:** quantos veículos fizeram o diário e quantos esperam a decisão de
  liberar ou não (toque abre **Checklist de hoje**).

Na hora, o app pergunta ao sistema o que avisar (`/api/lembretes`, com o login do próprio app). Sem internet às 08:00,
o motorista recebe um lembrete simples. Na primeira abertura o Android pede para permitir notificações (Android 13+).
Os alarmes voltam sozinhos depois de reiniciar o celular.

**Login no celular.** A sessão fica salva no app e não expira sozinha: o cookie vale 400 dias e é renovado a cada uso
(inclusive pelo lembrete das 08:00, que grava a sessão renovada antes de terminar). Ela só acaba se a pessoa tocar em
*Sair*, se a senha for trocada, ou se o projeto do Supabase limitar as sessões (*Authentication → Sessions*:
*Time-box user sessions* e *Inactivity timeout* devem ficar desligados, ou em 30 dias ou mais). Se a sessão acabar, o
lembrete das 08:00 vira *Entre no app para receber os lembretes*, para o motorista não ficar sem aviso.

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

**Cadastro de motorista na fase de testes.** Por enquanto só **nome e e-mail** são obrigatórios: CPF, WhatsApp e os
dados da CNH podem ficar em branco ou receber números fictícios (só o formato é conferido: 11 dígitos; WhatsApp com
DDD). O e-mail não precisa existir (ex.: `motorista1@teste.com`): ele é só o login do app. Para voltar a exigir os dados
reais (com os dígitos verificadores do CPF e da CNH), coloque `MOTORISTA_DADOS_OBRIGATORIOS=1` no `/opt/frotas/.env` e
rode `bash /opt/frotas/deploy/atualizar.sh`; os motoristas já cadastrados sem esses dados terão de ser completados na
próxima edição.

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
seguinte) e **só o KM digitado nos abastecimentos**: o KM do checklist nunca entra na conta (ele só serve de mínimo
para o KM do abastecimento). Ex.: checklist com 100 km, 2 km até o posto, tanque cheio com 102 km: o ciclo vai do
tanque cheio anterior até 102 km. O painel mostra o custo de **manutenção** e o de **combustível** em gráficos
separados.

**Acompanhamento** (supervisor e Administrador Geral, em *Abastecimentos → Acompanhamento*): o período escolhido com
valor pago, descontos, litros, preço médio com desconto e da bomba, consumo, custo por km, cupons a conferir e
lançamentos sem foto; totais **por veículo, por motorista e por posto**; e cada lançamento com todos os detalhes
(preço da bomba, desconto, unitário com desconto, KM, quanto rodou desde o anterior, km/l, posto, horário do registro,
KM e placa impressos no cupom, se os valores vieram da leitura da foto e se foram mudados à mão). Filtros por data,
veículo, motorista, combustível, posto e situação. **Exportar planilha** gera um CSV com os mesmos filtros (abre no
Excel ou no Planilhas Google; use no computador).

**Nota de abastecimento: desconto e preço por litro.** O cupom mostra o valor total e o desconto, mas não o preço
por litro com desconto. O lançamento pede **litros, valor total e desconto** e calcula sozinho:

| Valor | Conta |
|---|---|
| **Valor líquido** (o que foi pago; entra nos custos) | valor total − desconto |
| **Unitário com desconto** (preço por litro gravado) | valor líquido ÷ litros |
| Preço da bomba (só para conferir) | valor total ÷ litros |

**Leitura automática do cupom (Gemini, opcional).** A foto do cupom vem primeiro no lançamento e passa pelo
**modo digitalização** no próprio celular (recorta o papel, tira a sombra, reforça o contraste e escurece a
impressão térmica apagada). Com a chave do Gemini no servidor, a foto é lida e os campos são preenchidos: litros,
valor total, desconto, combustível, data e posto. A pessoa confere e registra.
- A IA só **transcreve** os números impressos; as contas são feitas pelo sistema e **conferidas com o próprio
  cupom** (litros × preço da bomba = valor total; valor total − desconto = valor a pagar). Se algo não bate, o
  resumo mostra **Confira** e o motivo; se tudo bate, **Conferido**.
- **Dígito lido errado:** se as contas não fecham, o sistema procura **um** número com um dígito trocado (ex.: 40,35 L
  lido como 45,35 L) cuja correção fecha **todas** as contas no centavo, e só corrige quando essa correção é a única
  possível (números impressos duas vezes iguais, como o valor pago da DANFE, nunca são trocados). O campo corrigido
  aparece destacado (*corrigido · lido 45,35 L*) e o resumo pede *Corrigido: confira*. Se mais de um número pode
  estar errado, nada é adivinhado: a pessoa confere na foto.
- **KM impresso** (digitado pelo frentista): só preenche o hodômetro se estiver entre o último KM do veículo e 3.000 km
  acima dele; fora disso, avisa e deixa para digitar (KM errado estragaria o consumo).
- **Velocidade e modelos novos:** o modelo responde com o mínimo de "raciocínio" (mais rápido) e no formato
  pedido. O Google troca o modelo por trás de `gemini-flash-latest` sem aviso, e cada família aceita ajustes
  diferentes (a 3.x recusa `thinkingBudget: 0`, algumas recusam `thinkingLevel: "minimal"`, e o `responseSchema`
  virou legado). Se o Google recusar o pedido, o sistema lê a mensagem e repete com o ajuste seguinte
  (raciocínio: `minimal` → `low` → `thinkingBudget 0` → padrão; formato: `responseSchema` → `responseJsonSchema` →
  só JSON) e lembra do que funcionou para as próximas leituras. Se o modelo não responde em 10 s, o próximo da lista
  começa em paralelo e vale a primeira resposta (o mais lento é cancelado); a leitura toda tem até 45 s. O
  resumo mostra quanto levou cada etapa (*foto · envio · leitura*). Se a leitura falhar, a tela
  **Testar leitura de cupons** (Administrador Geral) mostra o motivo exato devolvido pelo Google.
- **Resposta que não termina:** o modo JSON do Gemini às vezes "dispara" (espaços e quebras de linha sem fim). A
  resposta tem teto de tokens; se bate nele, o sistema repete no formato seguinte.
- **Diagnóstico na VPS:** `bash /opt/frotas/deploy/testar-gemini.sh [foto-do-cupom.jpg]` chama cada modelo de dentro do
  container (mesma chave e rede) e mostra status, tempo, tokens e o começo da resposta.
- Nota com outros produtos (ARLA, óleo…): usa a linha do combustível; desconto só da nota inteira é dividido
  proporcionalmente, com aviso.
- Modelos ajustados com notas reais da frota: **NFC-e** (sistema xpert: quantidade impressa com ponto, "5.413 LT" =
  5,413 L; desconto e valor líquido na linha do item) e **DANFE A4** ("VALOR TOTAL DOS PRODUTOS" antes do desconto,
  "VALOR TOTAL DA NOTA" já com desconto, "% DESCONTO" é porcentagem). Se a leitura trocar esses campos, o cálculo
  percebe pelas conferências e corrige, com aviso.
- **Placa impressa** (notas de convênio/frota): é comparada com o veículo escolhido; placa diferente pede conferência
  (abastecimento de outro veículo ou desvio).
- O que foi lido fica gravado no lançamento (`leitura_cupom`) para conferência.
- **Chave gratuita:** crie em [aistudio.google.com/apikey](https://aistudio.google.com/apikey), coloque em
  `GEMINI_API_KEY` no `/opt/frotas/.env` da VPS e rode o instalador. A chave fica só no servidor.
  `GEMINI_MODELOS` define a ordem dos modelos (padrão `gemini-flash-latest,gemini-flash-lite-latest`): se o limite
  gratuito de um acabar, usa o próximo. Os dois `-latest` entram sempre no fim da lista, então um modelo
  configurado que o Google desligou não deixa a leitura parada. Sem chave, sem cota ou sem internet, o lançamento é digitado à mão (as
  contas continuam automáticas).
- No plano gratuito, o Google pode usar as imagens enviadas para melhorar os produtos dele. Para que isso não
  aconteça, ative o faturamento no projeto da chave (plano pago).
- **Testar leitura de cupons** (Administrador Geral, em Abastecimentos): envie fotos de vários modelos de nota e
  veja o que é lido em cada uma, sem lançar nada (as fotos são apagadas depois). *Copiar resultados* gera um
  resumo para ajustar as instruções da leitura (`src/lib/abastecimento/prompt-cupom.ts`) a um modelo novo.
- Limites: 10 leituras por minuto e 80 por dia por usuário (protege a cota gratuita).

**Consumo fora do padrão.** Cada ciclo (tanque cheio a tanque cheio) é comparado com a média dos até 5 ciclos normais
anteriores do mesmo veículo e combustível (precisa de pelo menos 2):

| Variação | Aviso | Causas prováveis |
|---|---|---|
| km/l **≥ 25% abaixo** | Consumo X% abaixo do normal | vazamento, desvio de combustível, KM lançado errado, problema mecânico |
| km/l **≥ 60% acima** | Consumo X% acima do normal | KM digitado errado ou tanque que não foi completado |

Aparece no lançamento (lista de abastecimentos, veículo e motorista) e no painel (*Consumo fora do padrão*, último ciclo
dos últimos 60 dias). Um ciclo fora do padrão não entra na média dos próximos.

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
| **Diário** | Exterior (frente, traseira, 2 laterais) · **Pneus** (os 4) · **Retrovisores** (os 2 espelhos e a **carcaça** de cada um, por trás) · **Motor e fluidos** (óleo, fluido de freio, água do arrefecimento) · Cabine (painel com KM, **bancos**) — 17 fotos |
| **Semanal** | Diário + luzes, para-brisa, estepe, carroceria/porta-malas — 21 fotos |
| **Mensal** | Semanal + compartimento do motor, equipamentos obrigatórios — 23 fotos |

Em todos os tipos: **"O veículo tem algum vazamento ou avaria?" Sim/Não** — no "Sim" a foto (com Atenção/Avaria e
descrição) passa a ser obrigatória. O Administrador Geral ajusta o que cada tipo exige em **Checklists → Modelos**.

Só câmera: não existe opção de galeria e fotos antigas são recusadas. A câmera abre **dentro da própria tela** (o app
não sai para o app de câmera do celular): em aparelhos com pouca memória, como o Redmi 14C, o Android encerrava o app ou
o Chrome enquanto a câmera do celular estava aberta e a foto se perdia na volta. A foto sai em até 1920 px (o envio
reduz para 1600 px), com botão de lanterna quando o aparelho oferece. Se a câmera na tela não abrir (permissão negada
ou APK antigo), o botão *Usar o app de câmera* abre a câmera do celular como antes. No APK, a permissão de câmera é
pedida na primeira foto (APK 1.0.10 ou mais novo; no antigo, a tela avisa e oferece o download do app atualizado). Se a
pessoa tiver negado de vez, o app abre as configurações dele para liberar a câmera.
**Compressão no aparelho** (fotos de 3–12 MB viram ~300 KB), upload direto ao Storage item a item com novas tentativas,
**pins de avaria tocando na foto**, status geral em tempo real e rascunho que sobrevive ao recarregar a página. O envio
final é uma RPC atômica (`salvar_checklist`) que confere as fotos com o modelo do tipo e grava checklist + fotos + KM
numa transação.

**Rotina (horário de Pimenta Bueno/RO).**
- **Diário — não é obrigatório.** O motorista faz até as **08:30**. Depois disso, o supervisor abre **Checklist de
  hoje** (menu, painel ou a notificação das 08:30), vê quem fez e decide, para cada veículo sem checklist, **Liberar**
  ou **Não liberar** para uso hoje (com observação opcional; pode mudar no mesmo dia). *Não liberado hoje* vale até o
  veículo fazer o checklist do dia.
- **Semanal — obrigatório no sábado ou no domingo.** Sem ele, o veículo fica **não liberado** de segunda em diante,
  até fazer (vale a partir do fim de semana de 10/10/2026; veículo cadastrado depois do sábado só entra no próximo).
- **Mensal:** o do mês, sem bloqueio.

Um checklist maior cobre os menores (o mensal vale como semanal e diário; o semanal, como diário). O painel mostra o
quadro *Checklists* com os três e o que espera decisão; veículos parados por avaria ficam fora da cobrança até o
conserto. O motorista vê a mesma situação em **Meu veículo**, com o aviso em vermelho quando o veículo não está liberado.

**Sem sinal (APK e navegador).** O checklist funciona sem internet: as fotos ficam guardadas no aparelho (*No aparelho ·
envia quando houver internet*) e, ao tocar em *Enviar*, o checklist inteiro vai para uma fila no celular. Quando a
conexão volta, ele é enviado sozinho, com as fotos, em qualquer tela do app (ou na próxima vez que o app abrir). Um
aviso mostra quantos estão esperando. Se o servidor recusar (ex.: KM menor que o último), o aviso mostra o motivo.
Sem sinal, a tela do checklist abre do próprio aparelho; as demais telas mostram *Sem internet* com o atalho para o
checklist. Para isso o app precisa ter sido aberto **com internet ao menos uma vez** depois da atualização.

## Avaria crítica → manutenção
Checklist com **Avaria** (o nível crítico) abre sozinho uma **manutenção corretiva** vinculada ao checklist, com a
descrição das avarias, e marca o veículo como **🚫 Não liberado** (painel, lista, veículo e Meu veículo do motorista).
Mais avarias no mesmo veículo antes do conserto entram na mesma manutenção.

O veículo volta a ficar liberado de duas formas:
- **Concluindo a manutenção** (*Manutenções → Concluir*): informa data, KM, custo e oficina; a avaria sai do semáforo.
- **Liberação pelo responsável** (supervisor da filial ou Administrador Geral) com **motivo obrigatório**, que fica
  registrado com o nome e a hora. O conserto continua pendente (🟡 *Conserto pendente*) até a manutenção ser concluída.

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
- Sem sinal funciona só o checklist (abastecimento e cadastros precisam de internet). Os checklists guardados ficam
  no aparelho em que foram feitos: desinstalar o app ou limpar os dados dele antes do envio os perde.
- A tabela `checklist_rascunhos` (migration 20260102) foi criada para a versão Streamlit; a web guarda o rascunho no
  próprio aparelho e não a usa — pode ficar como está.
