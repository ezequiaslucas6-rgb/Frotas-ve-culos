-- =============================================================================
-- Rascunho do checklist em andamento (um por usuário)
--
-- Por que existe: no Streamlit a sessão vive no servidor; se o celular perde a
-- conexão (tela bloqueada, troca de app, sinal fraco) o estado em memória some.
-- As fotos já estão no Storage; aqui ficam só os metadados (veículo, motorista,
-- etapa atual, severidades, observações e marcadores) para retomar de onde parou.
-- =============================================================================
create table public.checklist_rascunhos (
  user_id       uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  dados         jsonb not null check (jsonb_typeof(dados) = 'object'),
  atualizado_em timestamptz not null default now()
);

alter table public.checklist_rascunhos enable row level security;
revoke all on public.checklist_rascunhos from anon;

-- Cada usuário enxerga e altera SOMENTE o próprio rascunho (nem o admin lê o dos outros).
create policy rascunhos_dono on public.checklist_rascunhos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
