-- =============================================================================
-- Gestão de Frotas — schema inicial (Supabase / PostgreSQL 15+)
--
-- Conteúdo:
--   1. Enums
--   2. Tabelas (com FKs compostas que impedem referências entre filiais)
--   3. Índices
--   4. Funções auxiliares de RBAC (schema privado, não exposto via PostgREST)
--   5. Row Level Security (admin = global, supervisor = somente a própria filial)
--   6. View do painel (security_invoker => herda a RLS de quem consulta)
--   7. RPC atômica salvar_checklist
--   8. Storage (buckets privados + políticas por pasta de filial)
--
-- Convenção de Storage: <filial_id>/<...>. O primeiro segmento do caminho é
-- SEMPRE o UUID da filial; é ele que a RLS do Storage usa para isolar arquivos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ENUMS
-- -----------------------------------------------------------------------------
create type public.user_role         as enum ('admin', 'supervisor');
create type public.motorista_status as enum ('ativo', 'inativo', 'afastado', 'ferias');
create type public.checklist_status  as enum ('ok', 'atencao', 'critico');
create type public.manutencao_tipo   as enum ('preventiva', 'corretiva');
create type public.alerta_status     as enum ('ok', 'proximo', 'vencido');
create type public.categoria_foto    as enum (
  'lateral_direita',
  'lateral_esquerda',
  'frente',
  'traseira',
  'carroceria_portamalas',
  'interior',
  'painel',
  'rodas',
  'nivel_oleo',
  'nivel_agua',
  'motor',
  'retrovisores',
  'para_brisa',
  'luzes_sinalizacao'
);

-- -----------------------------------------------------------------------------
-- 2. TABELAS
-- -----------------------------------------------------------------------------
create table public.filiais (
  id          uuid primary key default gen_random_uuid(),
  nome_cidade text not null check (char_length(btrim(nome_cidade)) >= 2),
  uf          char(2) not null check (uf ~ '^[A-Z]{2}$'),
  created_at  timestamptz not null default now(),
  unique (nome_cidade, uf)
);

-- Um perfil por usuário do Supabase Auth.
--   admin      -> filial_id NULL (visão global)
--   supervisor -> filial_id obrigatório (uma única filial)
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null check (char_length(btrim(nome)) >= 2),
  role       public.user_role not null default 'supervisor',
  filial_id  uuid references public.filiais (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint profiles_role_filial_chk check (
    (role = 'admin'      and filial_id is null) or
    (role = 'supervisor' and filial_id is not null)
  )
);

-- Dados normalizados: cpf/cnh = 11 dígitos; whatsapp = 55 + DDD + número.
create table public.motoristas (
  id         uuid primary key default gen_random_uuid(),
  filial_id  uuid not null references public.filiais (id) on delete restrict,
  nome       text not null check (char_length(btrim(nome)) >= 2),
  cpf        text not null check (cpf ~ '^[0-9]{11}$'),
  email      text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp   text not null check (whatsapp ~ '^55[0-9]{10,11}$'),
  cnh        text not null check (cnh ~ '^[0-9]{11}$'),
  status     public.motorista_status not null default 'ativo',
  created_at timestamptz not null default now(),
  unique (id, filial_id),        -- alvo das FKs compostas
  unique (filial_id, cpf)
);

-- documento_url / foto_geral_url guardam o CAMINHO no bucket "veiculos"
-- (a aplicação gera URLs assinadas na leitura).
create table public.veiculos (
  id                     uuid primary key default gen_random_uuid(),
  filial_id              uuid not null references public.filiais (id) on delete restrict,
  placa                  text not null unique check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  marca                  text,
  modelo                 text,
  ano                    smallint check (ano between 1950 and 2100),
  documento_url          text,
  foto_geral_url         text,
  km_atual               integer not null default 0 check (km_atual >= 0),
  -- plano de revisão preventiva (base dos alertas por KM e por período)
  intervalo_revisao_km   integer not null default 10000 check (intervalo_revisao_km > 0),
  intervalo_revisao_dias integer not null default 180   check (intervalo_revisao_dias > 0),
  proxima_revisao_km     integer check (proxima_revisao_km >= 0),
  proxima_revisao_data   date,
  created_at             timestamptz not null default now(),
  unique (id, filial_id)
);

-- As FKs compostas (veiculo_id, filial_id) garantem no próprio banco que o
-- checklist/manutenção pertence à MESMA filial do veículo e do motorista.
create table public.checklists (
  id                 uuid primary key default gen_random_uuid(),
  veiculo_id         uuid not null,
  motorista_id       uuid not null,
  filial_id          uuid not null,
  supervisor_id      uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  data_envio         timestamptz not null default now(),
  observacoes_gerais text,
  status             public.checklist_status not null default 'ok',
  km_registro        integer check (km_registro >= 0),
  constraint checklists_filial_fk    foreign key (filial_id) references public.filiais (id) on delete restrict,
  constraint checklists_veiculo_fk   foreign key (veiculo_id, filial_id)   references public.veiculos (id, filial_id),
  constraint checklists_motorista_fk foreign key (motorista_id, filial_id) references public.motoristas (id, filial_id)
);

-- foto_url guarda o CAMINHO no bucket "checklists".
-- marcadores: pins de avaria sobre a foto, ex.: [{"x": 42.5, "y": 61.0}] (% da imagem).
create table public.checklist_fotos (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.checklists (id) on delete cascade,
  categoria_foto public.categoria_foto not null,
  foto_url       text not null,
  observacao     text,
  severidade     public.checklist_status not null default 'ok',
  marcadores     jsonb not null default '[]'::jsonb check (jsonb_typeof(marcadores) = 'array'),
  created_at     timestamptz not null default now(),
  unique (checklist_id, categoria_foto)
);

create table public.manutencoes (
  id                   uuid primary key default gen_random_uuid(),
  veiculo_id           uuid not null,
  filial_id            uuid not null,
  tipo                 public.manutencao_tipo not null,
  custo                numeric(12, 2) not null default 0 check (custo >= 0),
  descricao            text not null check (char_length(btrim(descricao)) >= 3),
  km_registro          integer not null check (km_registro >= 0),
  data_manutencao      date not null default current_date,
  -- estado do alerta da PRÓXIMA revisão (mantido por server actions / cron diário)
  status_alerta        public.alerta_status not null default 'ok',
  proxima_revisao_km   integer check (proxima_revisao_km >= 0),
  proxima_revisao_data date,
  fornecedor           text,
  created_by           uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint manutencoes_filial_fk  foreign key (filial_id) references public.filiais (id) on delete restrict,
  constraint manutencoes_veiculo_fk foreign key (veiculo_id, filial_id) references public.veiculos (id, filial_id)
);

-- -----------------------------------------------------------------------------
-- 3. ÍNDICES
-- -----------------------------------------------------------------------------
create index profiles_filial_idx          on public.profiles (filial_id);
create index motoristas_filial_idx        on public.motoristas (filial_id);
create index veiculos_filial_idx          on public.veiculos (filial_id);
create index checklists_filial_data_idx   on public.checklists (filial_id, data_envio desc);
create index checklists_veiculo_data_idx  on public.checklists (veiculo_id, data_envio desc);
create index checklists_motorista_idx     on public.checklists (motorista_id);
create index manutencoes_veiculo_data_idx on public.manutencoes (veiculo_id, data_manutencao desc);
create index manutencoes_filial_data_idx  on public.manutencoes (filial_id, data_manutencao desc);

-- -----------------------------------------------------------------------------
-- 4. FUNÇÕES AUXILIARES DE RBAC
-- Ficam no schema "private" (não exposto pelo PostgREST). São SECURITY DEFINER
-- para ler public.profiles sem disparar a RLS da própria tabela (evita recursão).
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create or replace function private.my_filial_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.filial_id from public.profiles p where p.id = (select auth.uid());
$$;

revoke all on function private.is_admin()      from public;
revoke all on function private.my_filial_id()  from public;
grant execute on function private.is_admin()     to authenticated, service_role;
grant execute on function private.my_filial_id() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- Regra geral: admin enxerga/altera tudo; supervisor só a própria filial.
-- Exclusões ficam restritas ao admin (histórico preservado; para "desligar" um
-- motorista o supervisor usa status = 'inativo').
-- -----------------------------------------------------------------------------
alter table public.filiais         enable row level security;
alter table public.profiles        enable row level security;
alter table public.motoristas      enable row level security;
alter table public.veiculos        enable row level security;
alter table public.checklists      enable row level security;
alter table public.checklist_fotos enable row level security;
alter table public.manutencoes     enable row level security;

-- anon nunca precisa tocar nas tabelas de negócio
revoke all on public.filiais, public.profiles, public.motoristas, public.veiculos,
              public.checklists, public.checklist_fotos, public.manutencoes
  from anon;

-- ---- filiais ----------------------------------------------------------------
create policy filiais_select on public.filiais for select to authenticated
  using ((select private.is_admin()) or id = (select private.my_filial_id()));
create policy filiais_admin_insert on public.filiais for insert to authenticated
  with check ((select private.is_admin()));
create policy filiais_admin_update on public.filiais for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy filiais_admin_delete on public.filiais for delete to authenticated
  using ((select private.is_admin()));

-- ---- profiles ---------------------------------------------------------------
-- Cada usuário lê o próprio perfil e os colegas da mesma filial (para exibir
-- "quem registrou"); admin lê todos. Somente admin escreve (impede que um
-- supervisor eleve o próprio role ou troque de filial).
create policy profiles_select on public.profiles for select to authenticated
  using (
    (select private.is_admin())
    or id = (select auth.uid())
    or (filial_id is not null and filial_id = (select private.my_filial_id()))
  );
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check ((select private.is_admin()));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using ((select private.is_admin()));

-- ---- motoristas -------------------------------------------------------------
create policy motoristas_select on public.motoristas for select to authenticated
  using ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy motoristas_insert on public.motoristas for insert to authenticated
  with check ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy motoristas_update on public.motoristas for update to authenticated
  using      ((select private.is_admin()) or filial_id = (select private.my_filial_id()))
  with check ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy motoristas_admin_delete on public.motoristas for delete to authenticated
  using ((select private.is_admin()));

-- ---- veiculos ---------------------------------------------------------------
create policy veiculos_select on public.veiculos for select to authenticated
  using ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy veiculos_insert on public.veiculos for insert to authenticated
  with check ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy veiculos_update on public.veiculos for update to authenticated
  using      ((select private.is_admin()) or filial_id = (select private.my_filial_id()))
  with check ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy veiculos_admin_delete on public.veiculos for delete to authenticated
  using ((select private.is_admin()));

-- ---- checklists (registro de evidência: supervisor cria e lê; admin corrige) --
create policy checklists_select on public.checklists for select to authenticated
  using ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy checklists_insert on public.checklists for insert to authenticated
  with check (
    supervisor_id = (select auth.uid())
    and ((select private.is_admin()) or filial_id = (select private.my_filial_id()))
  );
create policy checklists_admin_update on public.checklists for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy checklists_admin_delete on public.checklists for delete to authenticated
  using ((select private.is_admin()));

-- ---- checklist_fotos: herdam o acesso do checklist pai (a RLS do pai se aplica) --
create policy checklist_fotos_select on public.checklist_fotos for select to authenticated
  using (exists (select 1 from public.checklists c where c.id = checklist_id));
create policy checklist_fotos_insert on public.checklist_fotos for insert to authenticated
  with check (exists (select 1 from public.checklists c where c.id = checklist_id));
create policy checklist_fotos_admin_update on public.checklist_fotos for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy checklist_fotos_admin_delete on public.checklist_fotos for delete to authenticated
  using ((select private.is_admin()));

-- ---- manutencoes ------------------------------------------------------------
create policy manutencoes_select on public.manutencoes for select to authenticated
  using ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy manutencoes_insert on public.manutencoes for insert to authenticated
  with check ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy manutencoes_update on public.manutencoes for update to authenticated
  using      ((select private.is_admin()) or filial_id = (select private.my_filial_id()))
  with check ((select private.is_admin()) or filial_id = (select private.my_filial_id()));
create policy manutencoes_admin_delete on public.manutencoes for delete to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 6. VIEW DO PAINEL
-- security_invoker = true => a RLS das tabelas base é aplicada ao usuário que
-- consulta (sem isso a view rodaria com os privilégios do dono e vazaria dados).
-- Entrega os "ingredientes" da saúde da frota; a regra de negócio (liberado /
-- atenção / manutenção) fica em src/lib/maintenance/alerts.ts.
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
    limit 1)                                                      as ultima_preventiva_id
from public.veiculos v
join public.filiais f on f.id = v.filial_id
left join lateral (
  select ck.id, ck.status, ck.data_envio
    from public.checklists ck
   where ck.veiculo_id = v.id
   order by ck.data_envio desc
   limit 1
) c on true;

revoke all on public.vw_veiculos_painel from anon;
grant select on public.vw_veiculos_painel to authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPC ATÔMICA: salvar_checklist
-- Insere checklist + 14 fotos + atualiza o KM do veículo numa única transação.
-- SECURITY INVOKER: toda a RLS acima continua valendo para quem chama.
-- O status geral é derivado das fotos (a pior severidade vence).
-- -----------------------------------------------------------------------------
create or replace function public.salvar_checklist(
  p_id           uuid,
  p_veiculo_id   uuid,
  p_motorista_id uuid,
  p_observacoes  text,
  p_km           integer,
  p_fotos        jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_filial    uuid;
  v_esperadas integer := array_length(enum_range(null::public.categoria_foto), 1);
  v_status    public.checklist_status;
begin
  select v.filial_id into v_filial from public.veiculos v where v.id = p_veiculo_id;
  if v_filial is null then
    raise exception 'Veículo não encontrado ou sem permissão de acesso' using errcode = '42501';
  end if;

  if jsonb_typeof(p_fotos) is distinct from 'array'
     or jsonb_array_length(p_fotos) <> v_esperadas
     or (select count(distinct f ->> 'categoria_foto') from jsonb_array_elements(p_fotos) f) <> v_esperadas
  then
    raise exception 'O checklist exige as % fotos obrigatórias (uma por categoria)', v_esperadas
      using errcode = '23514';
  end if;

  select case
           when bool_or(coalesce(f ->> 'severidade', 'ok') = 'critico') then 'critico'
           when bool_or(coalesce(f ->> 'severidade', 'ok') = 'atencao') then 'atencao'
           else 'ok'
         end::public.checklist_status
    into v_status
    from jsonb_array_elements(p_fotos) f;

  insert into public.checklists
    (id, veiculo_id, motorista_id, filial_id, observacoes_gerais, status, km_registro)
  values
    (p_id, p_veiculo_id, p_motorista_id, v_filial, nullif(btrim(p_observacoes), ''), v_status, p_km);

  insert into public.checklist_fotos
    (checklist_id, categoria_foto, foto_url, observacao, severidade, marcadores)
  select p_id,
         (f ->> 'categoria_foto')::public.categoria_foto,
         f ->> 'foto_url',
         nullif(btrim(f ->> 'observacao'), ''),
         coalesce(f ->> 'severidade', 'ok')::public.checklist_status,
         coalesce(f -> 'marcadores', '[]'::jsonb)
    from jsonb_array_elements(p_fotos) f;

  if p_km is not null then
    update public.veiculos set km_atual = greatest(km_atual, p_km) where id = p_veiculo_id;
  end if;

  return p_id;
end;
$$;

revoke all on function public.salvar_checklist(uuid, uuid, uuid, text, integer, jsonb) from public, anon;
grant execute on function public.salvar_checklist(uuid, uuid, uuid, text, integer, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. STORAGE
-- Buckets privados (acesso somente por URL assinada). Caminho: <filial_id>/...
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('veiculos',   'veiculos',   false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('checklists', 'checklists', false,  5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy frota_storage_select on storage.objects for select to authenticated
  using (
    bucket_id in ('veiculos', 'checklists')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  );

create policy frota_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('veiculos', 'checklists')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  );

-- UPDATE é necessário para o upsert (refazer uma foto no mesmo caminho)
create policy frota_storage_update on storage.objects for update to authenticated
  using (
    bucket_id in ('veiculos', 'checklists')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  )
  with check (
    bucket_id in ('veiculos', 'checklists')
    and ((select private.is_admin())
         or (storage.foldername(name))[1] = (select private.my_filial_id())::text)
  );

create policy frota_storage_admin_delete on storage.objects for delete to authenticated
  using (bucket_id in ('veiculos', 'checklists') and (select private.is_admin()));
