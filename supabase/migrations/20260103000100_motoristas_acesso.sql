-- =============================================================================
-- Acesso do motorista, CNH, veículo responsável, abastecimentos e "Meu perfil"
-- (requer 20260103000000_papel_motorista.sql já executada)
--
-- Conteúdo:
--   1. Perfis: papel motorista + foto
--   2. Motoristas: login (user_id) + dados e imagens da CNH
--   3. Veículos: motorista responsável
--   4. Abastecimentos (lançados pelo próprio motorista)
--   5. Funções de RBAC do motorista
--   6. Gatilhos (KM, sincronia de nome e proteção do vínculo de login)
--   7. Row Level Security
--   8. View do painel (+ motorista responsável)
--   9. RPC atualizar_meu_perfil
--  10. Storage (CNH, comprovantes e fotos de perfil)
--
-- Modelo de acesso do motorista: enxerga SOMENTE o próprio cadastro, os veículos
-- em que é o responsável e os abastecimentos que ele mesmo lançou. Nunca lê
-- checklists, manutenções, custos nem dados de outros motoristas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PERFIS
-- -----------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_filial_chk;
alter table public.profiles add constraint profiles_role_filial_chk check (
  (role = 'admin' and filial_id is null) or
  (role in ('supervisor', 'motorista') and filial_id is not null)
);

-- caminho no bucket "perfis": <user_id>/avatar-<n>.jpg
alter table public.profiles add column avatar_url text;

-- -----------------------------------------------------------------------------
-- 2. MOTORISTAS: login + CNH
-- user_id é definido SOMENTE pelo servidor (service role) ao criar o acesso.
-- cnh_frente_url / cnh_verso_url guardam o CAMINHO no bucket "motoristas".
-- -----------------------------------------------------------------------------
alter table public.motoristas
  add column user_id                  uuid unique references public.profiles (id) on delete set null,
  add column cnh_categoria            text check (cnh_categoria ~ '^(ACC|A|B|C|D|E|AB|AC|AD|AE)$'),
  add column cnh_validade             date,
  add column cnh_primeira_habilitacao date,
  add column cnh_emissao              date,
  add column cnh_uf                   char(2) check (cnh_uf ~ '^[A-Z]{2}$'),
  add column cnh_ear                  boolean not null default false, -- "Exerce Atividade Remunerada"
  add column cnh_observacoes          text check (char_length(cnh_observacoes) <= 500),
  add column cnh_frente_url           text,
  add column cnh_verso_url            text,
  add constraint motoristas_cnh_datas_chk check (
    (cnh_validade is null or cnh_emissao is null or cnh_validade > cnh_emissao)
    and (cnh_emissao is null or cnh_primeira_habilitacao is null or cnh_emissao >= cnh_primeira_habilitacao)
  );

-- -----------------------------------------------------------------------------
-- 3. VEÍCULOS: motorista responsável (FK composta => sempre da MESMA filial)
-- -----------------------------------------------------------------------------
alter table public.veiculos
  add column motorista_id uuid,
  add constraint veiculos_motorista_fk foreign key (motorista_id, filial_id)
    references public.motoristas (id, filial_id) on delete set null (motorista_id);

create index veiculos_motorista_idx on public.veiculos (motorista_id);

-- -----------------------------------------------------------------------------
-- 4. ABASTECIMENTOS
-- Registro de evidência: o motorista lança, supervisor/admin acompanham; só o
-- admin corrige ou exclui (como nos checklists).
-- comprovante_url guarda o CAMINHO no bucket "abastecimentos".
-- -----------------------------------------------------------------------------
create type public.combustivel as enum (
  'gasolina', 'gasolina_aditivada', 'etanol', 'diesel_s10', 'diesel_s500', 'gnv'
);

create table public.abastecimentos (
  id                 uuid primary key default gen_random_uuid(),
  veiculo_id         uuid not null,
  filial_id          uuid not null,
  motorista_id       uuid,
  registrado_por     uuid default auth.uid() references public.profiles (id) on delete set null,
  data_abastecimento date not null default current_date,
  km                 integer not null check (km >= 0),
  litros             numeric(9, 3) not null check (litros > 0 and litros <= 5000),
  valor_total        numeric(12, 2) not null check (valor_total > 0),
  preco_litro        numeric(10, 3) generated always as (round(valor_total / litros, 3)) stored,
  combustivel        public.combustivel not null,
  tanque_cheio       boolean not null default true,
  posto              text check (char_length(posto) <= 120),
  comprovante_url    text,
  observacao         text check (char_length(observacao) <= 1000),
  created_at         timestamptz not null default now(),
  constraint abastecimentos_filial_fk    foreign key (filial_id) references public.filiais (id) on delete restrict,
  constraint abastecimentos_veiculo_fk   foreign key (veiculo_id, filial_id)   references public.veiculos (id, filial_id),
  constraint abastecimentos_motorista_fk foreign key (motorista_id, filial_id) references public.motoristas (id, filial_id)
);

create index abastecimentos_veiculo_km_idx   on public.abastecimentos (veiculo_id, km desc);
create index abastecimentos_filial_data_idx  on public.abastecimentos (filial_id, data_abastecimento desc);
create index abastecimentos_motorista_idx    on public.abastecimentos (motorista_id, data_abastecimento desc);

-- -----------------------------------------------------------------------------
-- 5. FUNÇÕES DE RBAC
-- my_filial_id() passa a valer SÓ para supervisores. O motorista também tem
-- filial no perfil, mas não pode herdar o acesso amplo do supervisor: com esta
-- troca, TODAS as políticas existentes continuam fechadas para ele.
-- -----------------------------------------------------------------------------
create or replace function private.my_filial_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.filial_id from public.profiles p
   where p.id = (select auth.uid()) and p.role = 'supervisor';
$$;

-- Cadastro do motorista logado (nulo para admin/supervisor ou motorista inativo).
create or replace function private.meu_motorista_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
    from public.motoristas m
    join public.profiles p on p.id = m.user_id and p.role = 'motorista'
   where m.user_id = (select auth.uid()) and m.status <> 'inativo';
$$;

-- Veículos em que o motorista logado é o responsável.
create or replace function private.meus_veiculos()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(v.id), '{}')
    from public.veiculos v
   where v.motorista_id = (select private.meu_motorista_id());
$$;

create or replace function private.minha_filial_motorista()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.filial_id from public.motoristas m where m.id = (select private.meu_motorista_id());
$$;

-- Pastas de comprovantes em que o motorista pode gravar: <filial_id>/<veiculo_id>/...
create or replace function private.motorista_pode_enviar(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.veiculos v
     where array[v.id] <@ (select private.meus_veiculos())
       and (storage.foldername(p_name))[1] = v.filial_id::text
       and (storage.foldername(p_name))[2] = v.id::text
  );
$$;

-- Arquivos que o motorista pode abrir: a própria CNH, documento/foto dos seus
-- veículos e os comprovantes desses veículos.
create or replace function private.motorista_pode_ler(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.meu_motorista_id()) is null then false
    when p_bucket = 'motoristas' then exists (
      select 1 from public.motoristas m
       where m.id = (select private.meu_motorista_id()) and p_name in (m.cnh_frente_url, m.cnh_verso_url))
    when p_bucket = 'veiculos' then exists (
      select 1 from public.veiculos v
       where array[v.id] <@ (select private.meus_veiculos()) and p_name in (v.documento_url, v.foto_geral_url))
    when p_bucket = 'abastecimentos' then private.motorista_pode_enviar(p_name)
    else false
  end;
$$;

revoke all on function private.meu_motorista_id()                from public;
revoke all on function private.meus_veiculos()                   from public;
revoke all on function private.minha_filial_motorista()          from public;
revoke all on function private.motorista_pode_enviar(text)       from public;
revoke all on function private.motorista_pode_ler(text, text)    from public;
grant execute on function private.meu_motorista_id()             to authenticated, service_role;
grant execute on function private.meus_veiculos()                to authenticated, service_role;
grant execute on function private.minha_filial_motorista()       to authenticated, service_role;
grant execute on function private.motorista_pode_enviar(text)    to authenticated, service_role;
grant execute on function private.motorista_pode_ler(text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. GATILHOS
-- -----------------------------------------------------------------------------
-- O abastecimento atualiza o KM do veículo (o motorista não tem UPDATE em veiculos).
-- O KM nunca regride.
create or replace function private.abastecimento_atualiza_km()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.veiculos set km_atual = greatest(km_atual, new.km) where id = new.veiculo_id;
  return null;
end;
$$;

create trigger abastecimentos_atualiza_km
  after insert on public.abastecimentos
  for each row execute function private.abastecimento_atualiza_km();

-- O nome (e a filial) do motorista vêm do cadastro: o perfil de login acompanha.
create or replace function private.motoristas_sincroniza_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    update public.profiles
       set nome = new.nome, filial_id = new.filial_id
     where id = new.user_id and role = 'motorista';
  end if;
  return null;
end;
$$;

create trigger motoristas_sincroniza_perfil
  after update of nome, filial_id on public.motoristas
  for each row execute function private.motoristas_sincroniza_perfil();

-- O vínculo de login (user_id) só muda pelo servidor (service role). Sem isto, um
-- supervisor poderia apontar o cadastro para o login de outra pessoa.
create or replace function private.motoristas_protege_acesso()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.user_id is not null)
          or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id)) then
    raise exception 'O acesso do motorista é gerenciado pelo sistema' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger motoristas_protege_acesso
  before insert or update of user_id on public.motoristas
  for each row execute function private.motoristas_protege_acesso();

-- -----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- Políticas permissivas se somam (OR) às já existentes.
-- -----------------------------------------------------------------------------
-- o motorista lê a própria filial (cabeçalho do app)
create policy filiais_select_motorista on public.filiais for select to authenticated
  using (id = (select private.minha_filial_motorista()));

-- o motorista lê o próprio cadastro (somente leitura)
create policy motoristas_select_proprio on public.motoristas for select to authenticated
  using (id = (select private.meu_motorista_id()));

-- o motorista lê somente os veículos em que é o responsável (somente leitura)
create policy veiculos_select_motorista on public.veiculos for select to authenticated
  using (motorista_id = (select private.meu_motorista_id()));

alter table public.abastecimentos enable row level security;
revoke all on public.abastecimentos from anon;

create policy abastecimentos_select on public.abastecimentos for select to authenticated
  using (
    (select private.is_admin())
    or filial_id = (select private.my_filial_id())
    or motorista_id = (select private.meu_motorista_id())
  );
create policy abastecimentos_insert on public.abastecimentos for insert to authenticated
  with check (
    registrado_por = (select auth.uid())
    and (
      (select private.is_admin())
      or filial_id = (select private.my_filial_id())
      or (motorista_id = (select private.meu_motorista_id())
          and array[veiculo_id] <@ (select private.meus_veiculos()))
    )
  );
create policy abastecimentos_admin_update on public.abastecimentos for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy abastecimentos_admin_delete on public.abastecimentos for delete to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 8. VIEW DO PAINEL (+ motorista responsável; colunas novas sempre ao final)
-- -----------------------------------------------------------------------------
create or replace view public.vw_veiculos_painel
with (security_invoker = true) as
select
  v.id,
  v.filial_id,
  v.placa,
  v.marca,
  v.modelo,
  v.ano,
  v.km_atual,
  v.foto_geral_url,
  v.documento_url,
  v.intervalo_revisao_km,
  v.intervalo_revisao_dias,
  v.proxima_revisao_km,
  v.proxima_revisao_data,
  v.created_at,
  f.nome_cidade,
  f.uf,
  c.id         as ultimo_checklist_id,
  c.status     as ultimo_checklist_status,
  c.data_envio as ultimo_checklist_em,
  (select max(m.data_manutencao)
     from public.manutencoes m
    where m.veiculo_id = v.id and m.tipo = 'corretiva')           as ultima_corretiva_em,
  (select m.id
     from public.manutencoes m
    where m.veiculo_id = v.id and m.tipo = 'preventiva'
    order by m.data_manutencao desc, m.created_at desc
    limit 1)                                                      as ultima_preventiva_id,
  v.motorista_id,
  mo.nome                                                         as motorista_nome
from public.veiculos v
join public.filiais f on f.id = v.filial_id
left join public.motoristas mo on mo.id = v.motorista_id
left join lateral (
  select ck.id, ck.status, ck.data_envio
    from public.checklists ck
   where ck.veiculo_id = v.id
   order by ck.data_envio desc
   limit 1
) c on true;

-- -----------------------------------------------------------------------------
-- 9. RPC atualizar_meu_perfil
-- profiles continua gravável só pelo admin (impede trocar o próprio papel/filial);
-- esta função altera APENAS nome e foto do próprio usuário. O nome do motorista
-- vem do cadastro (alterado pelo supervisor), então para ele só a foto muda.
-- -----------------------------------------------------------------------------
create or replace function public.atualizar_meu_perfil(p_nome text, p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role public.user_role;
begin
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null then
    raise exception 'Perfil não encontrado' using errcode = '42501';
  end if;
  if p_avatar_url is not null and left(p_avatar_url, 37) <> v_uid::text || '/' then
    raise exception 'Foto de perfil inválida' using errcode = '22023';
  end if;

  update public.profiles
     set nome       = case when v_role = 'motorista' then nome
                           else coalesce(nullif(btrim(p_nome), ''), nome) end,
         avatar_url = p_avatar_url
   where id = v_uid;
end;
$$;

revoke all on function public.atualizar_meu_perfil(text, text) from public, anon;
grant execute on function public.atualizar_meu_perfil(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. STORAGE
--   motoristas     -> <filial_id>/<pasta>/cnh-frente|cnh-verso.<ext>
--   abastecimentos -> <filial_id>/<veiculo_id>/<arquivo>.jpg
--   perfis         -> <user_id>/avatar-<n>.jpg
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('motoristas',     'motoristas',     false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('abastecimentos', 'abastecimentos', false,  5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('perfis',         'perfis',         false,  2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- admin/supervisor: mesma regra dos buckets existentes (pasta da filial)
create policy cadastros_storage_select on storage.objects for select to authenticated
  using (
    bucket_id in ('motoristas', 'abastecimentos')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  );
create policy cadastros_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('motoristas', 'abastecimentos')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  );
create policy cadastros_storage_update on storage.objects for update to authenticated
  using (
    bucket_id in ('motoristas', 'abastecimentos')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  )
  with check (
    bucket_id in ('motoristas', 'abastecimentos')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  );
create policy cadastros_storage_admin_delete on storage.objects for delete to authenticated
  using (bucket_id in ('motoristas', 'abastecimentos') and (select private.is_admin()));

-- motorista: lê só o que é dele; grava só comprovantes dos próprios veículos
-- (nomes únicos por envio, sem sobrescrever)
create policy motorista_storage_select on storage.objects for select to authenticated
  using (private.motorista_pode_ler(bucket_id, name));
create policy motorista_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'abastecimentos' and private.motorista_pode_enviar(name));

-- foto de perfil: cada usuário na própria pasta (o admin também lê)
create policy perfis_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'perfis'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin()))
  );
create policy perfis_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'perfis' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy perfis_storage_update on storage.objects for update to authenticated
  using      (bucket_id = 'perfis' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'perfis' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy perfis_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'perfis' and (storage.foldername(name))[1] = (select auth.uid())::text);
