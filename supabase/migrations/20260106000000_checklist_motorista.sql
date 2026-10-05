-- =============================================================================
-- O motorista faz o checklist dos veículos em que é o responsável
-- =============================================================================
-- Até aqui só supervisor/admin registravam checklists. Agora o motorista também:
--   1. lê os checklists feitos em seu nome e grava checklist só dos próprios
--      veículos, sempre em seu nome (a RPC salvar_checklist é SECURITY INVOKER,
--      então estas políticas valem para ela também);
--   2. o KM do veículo passa a ser atualizado por gatilho (o motorista não tem
--      UPDATE em veiculos), como já acontece no abastecimento;
--   3. Storage "checklists": envia fotos só na pasta da própria filial e só para
--      um checklist ainda não enviado (o que já foi enviado não muda); lê as
--      próprias fotos e as dos checklists feitos em seu nome;
--   4. remover o acesso do motorista continua possível depois que ele fez
--      checklists (o "registrado por" fica vazio; o checklist fica no histórico).
-- Admin e supervisor continuam exatamente como estavam.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CHECKLISTS (políticas permissivas: somam-se às de admin/supervisor)
-- -----------------------------------------------------------------------------
create policy checklists_select_motorista on public.checklists for select to authenticated
  using (motorista_id = (select private.meu_motorista_id()));

create policy checklists_insert_motorista on public.checklists for insert to authenticated
  with check (
    supervisor_id = (select auth.uid())
    and motorista_id = (select private.meu_motorista_id())
    and array[veiculo_id] <@ (select private.meus_veiculos())
  );
-- checklist_fotos herdam o acesso do checklist pai (políticas da migration inicial)

-- -----------------------------------------------------------------------------
-- 2. KM DO VEÍCULO POR GATILHO (nunca regride)
-- -----------------------------------------------------------------------------
create or replace function private.checklist_atualiza_km()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.km_registro is not null then
    update public.veiculos set km_atual = greatest(km_atual, new.km_registro) where id = new.veiculo_id;
  end if;
  return null;
end;
$$;

create trigger checklists_atualiza_km
  after insert on public.checklists
  for each row execute function private.checklist_atualiza_km();

-- -----------------------------------------------------------------------------
-- 3. STORAGE "checklists" (caminho: <filial>/<checklist>/<item>.jpg)
-- -----------------------------------------------------------------------------
-- Pode enviar: motorista ativo com veículo, na pasta da própria filial, para um
-- checklist que ainda não existe (as fotos sobem antes do envio final).
create or replace function private.motorista_pode_enviar_checklist(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.meu_motorista_id()) is not null
     and cardinality((select private.meus_veiculos())) > 0
     and cardinality(storage.foldername(p_name)) = 2
     and (storage.foldername(p_name))[1] = (select private.minha_filial_motorista())::text
     and not exists (
       select 1 from public.checklists c where c.id::text = (storage.foldername(p_name))[2]
     );
$$;

-- Pode ver: fotos de um checklist feito em nome do motorista logado.
create or replace function private.motorista_ve_checklist(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.checklists c
     where c.id::text = (storage.foldername(p_name))[2]
       and c.motorista_id = (select private.meu_motorista_id())
  );
$$;

revoke all on function private.checklist_atualiza_km()                from public;
revoke all on function private.motorista_pode_enviar_checklist(text)  from public;
revoke all on function private.motorista_ve_checklist(text)           from public;
grant execute on function private.motorista_pode_enviar_checklist(text) to authenticated, service_role;
grant execute on function private.motorista_ve_checklist(text)          to authenticated, service_role;

create policy checklists_storage_motorista_select on storage.objects for select to authenticated
  using (
    bucket_id = 'checklists'
    and (select private.meu_motorista_id()) is not null
    and (owner_id = (select auth.uid())::text or private.motorista_ve_checklist(name))
  );
create policy checklists_storage_motorista_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'checklists' and private.motorista_pode_enviar_checklist(name));
-- refazer a foto (upsert) só do próprio arquivo e antes do envio do checklist
create policy checklists_storage_motorista_update on storage.objects for update to authenticated
  using (
    bucket_id = 'checklists'
    and owner_id = (select auth.uid())::text
    and private.motorista_pode_enviar_checklist(name)
  )
  with check (
    bucket_id = 'checklists'
    and owner_id = (select auth.uid())::text
    and private.motorista_pode_enviar_checklist(name)
  );

-- -----------------------------------------------------------------------------
-- 4. QUEM REGISTROU (supervisor_id) QUANDO O MOTORISTA PERDE O ACESSO
-- Remover o acesso do motorista apaga o login dele. O checklist que ele fez
-- continua no histórico, ligado ao cadastro (motorista_id); só o "registrado
-- por" fica vazio, como no abastecimento. Supervisor e admin com checklists
-- continuam sem poder ser excluídos (mesmo comportamento de antes).
-- -----------------------------------------------------------------------------
alter table public.checklists alter column supervisor_id drop not null;
alter table public.checklists drop constraint checklists_supervisor_id_fkey;
alter table public.checklists add constraint checklists_supervisor_id_fkey
  foreign key (supervisor_id) references public.profiles (id) on delete set null;

create or replace function private.protege_autor_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'motorista' and exists (select 1 from public.checklists c where c.supervisor_id = old.id) then
    raise exception 'O usuário possui checklists registrados (histórico preservado)' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function private.protege_autor_checklist() from public;

create trigger profiles_protege_autor_checklist
  before delete on public.profiles
  for each row execute function private.protege_autor_checklist();
