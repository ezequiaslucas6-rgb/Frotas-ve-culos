-- Emula o mínimo da plataforma Supabase (roles, auth.uid(), auth.users, storage.*)
-- para rodar a migration e os testes de RLS fora do Supabase (PGlite/Postgres puro).
-- NÃO aplicar no Supabase real: lá tudo isso já existe.

create role anon          nologin;
create role authenticated nologin;
create role service_role  nologin bypassrls;

create schema auth;
create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);
-- mesmo mecanismo do Supabase: o "sub" do JWT vem de uma GUC da requisição
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text,
  owner     uuid,
  owner_id  text, -- quem enviou (o Storage preenche com o uid do usuário)
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1:array_length(parts, 1) - 1];
end
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant all on all tables in schema storage to authenticated, service_role;
grant select on all tables in schema auth to service_role;

-- No Supabase, objetos novos em "public" já nascem acessíveis a estes roles;
-- é a RLS (e os REVOKEs da migration) que restringe o acesso.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
