-- =============================================================================
-- Avaria crítica no checklist => manutenção corretiva + veículo "não liberado"
-- =============================================================================
--   1. manutenções passam a ter situação (aberta/concluída) e o checklist de origem;
--   2. veiculo_bloqueios: histórico de "não liberado" (quem liberou, quando e por quê);
--   3. checklist com avaria crítica abre a manutenção corretiva (ou acrescenta à que já
--      está aberta) e bloqueia o veículo;
--   4. concluir a manutenção libera o veículo ("conserto");
--   5. liberar_veiculo: o supervisor da filial ou o admin libera com um motivo
--      ("responsável"); a manutenção continua pendente;
--   6. view do painel com o bloqueio aberto, a última liberação e os consertos
--      pendentes (corretiva só conta como feita quando concluída).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. MANUTENÇÃO ABERTA / CONCLUÍDA
-- As já registradas são serviços feitos: ficam "concluida".
-- -----------------------------------------------------------------------------
create type public.manutencao_situacao as enum ('aberta', 'concluida');

alter table public.manutencoes
  add column situacao      public.manutencao_situacao not null default 'concluida',
  add column checklist_id  uuid references public.checklists (id) on delete set null,
  add column concluida_em  timestamptz,
  add column concluida_por uuid references public.profiles (id) on delete set null;

create index manutencoes_abertas_idx on public.manutencoes (veiculo_id) where situacao = 'aberta';
create index manutencoes_checklist_idx on public.manutencoes (checklist_id) where checklist_id is not null;

-- -----------------------------------------------------------------------------
-- 2. BLOQUEIOS DO VEÍCULO (no máximo um aberto por veículo)
-- -----------------------------------------------------------------------------
create table public.veiculo_bloqueios (
  id            uuid primary key default gen_random_uuid(),
  veiculo_id    uuid not null,
  filial_id     uuid not null,
  checklist_id  uuid references public.checklists (id) on delete set null,
  manutencao_id uuid references public.manutencoes (id) on delete set null,
  motivo        text not null,
  bloqueado_em  timestamptz not null default now(),
  liberado_em   timestamptz,
  liberado_por  uuid references public.profiles (id) on delete set null,
  liberacao     text check (liberacao in ('conserto', 'responsavel')),
  liberacao_obs text,
  constraint veiculo_bloqueios_veiculo_fk foreign key (veiculo_id, filial_id)
    references public.veiculos (id, filial_id) on delete cascade,
  constraint veiculo_bloqueios_liberacao_chk check ((liberado_em is null) = (liberacao is null))
);
create unique index veiculo_bloqueios_um_aberto on public.veiculo_bloqueios (veiculo_id) where liberado_em is null;
create index veiculo_bloqueios_filial_idx on public.veiculo_bloqueios (filial_id, bloqueado_em desc);

alter table public.veiculo_bloqueios enable row level security;
revoke all on public.veiculo_bloqueios from anon;
-- leitura: admin, supervisor da filial e o motorista responsável. Escrita só pelas
-- funções abaixo (gatilhos e liberar_veiculo).
create policy veiculo_bloqueios_select on public.veiculo_bloqueios for select to authenticated
  using (
    (select private.is_admin())
    or filial_id = (select private.my_filial_id())
    or array[veiculo_id] <@ (select private.meus_veiculos())
  );

-- -----------------------------------------------------------------------------
-- 3. CHECKLIST COM AVARIA CRÍTICA
-- Gatilho adiado para o fim da transação: as fotos (com os itens e as descrições)
-- já foram gravadas pela RPC salvar_checklist.
-- -----------------------------------------------------------------------------
create or replace function private.checklist_avaria_critica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_itens text;
  v_desc  text;
  v_man   uuid;
  v_km    integer;
begin
  if new.status <> 'critico' then
    return null;
  end if;

  select string_agg(coalesce(i.nome, f.categoria_foto) || coalesce(': ' || nullif(btrim(f.observacao), ''), ''), '; '
                    order by coalesce(i.ordem, 9999))
    into v_itens
    from public.checklist_fotos f
    left join public.checklist_itens i on i.codigo = f.categoria_foto
   where f.checklist_id = new.id and f.severidade = 'critico';

  v_desc := format('Avaria no checklist %s de %s: %s',
                   case new.tipo when 'diario' then 'diário' else new.tipo::text end,
                   to_char(new.data_envio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
                   coalesce(v_itens, 'item marcado como avaria'));

  select coalesce(new.km_registro, v.km_atual) into v_km from public.veiculos v where v.id = new.veiculo_id;

  -- conserto já pendente (aberto por checklist): acrescenta, não duplica a manutenção
  select m.id into v_man
    from public.manutencoes m
   where m.veiculo_id = new.veiculo_id and m.situacao = 'aberta' and m.tipo = 'corretiva' and m.checklist_id is not null
   order by m.created_at desc
   limit 1;

  if v_man is null then
    insert into public.manutencoes
      (veiculo_id, filial_id, tipo, custo, descricao, km_registro, data_manutencao, situacao, checklist_id, created_by)
    values
      (new.veiculo_id, new.filial_id, 'corretiva', 0, v_desc, v_km,
       (now() at time zone 'America/Sao_Paulo')::date, 'aberta', new.id, new.supervisor_id)
    returning id into v_man;
  else
    update public.manutencoes set descricao = descricao || E'\n' || v_desc where id = v_man;
  end if;

  insert into public.veiculo_bloqueios (veiculo_id, filial_id, checklist_id, manutencao_id, motivo)
  values (new.veiculo_id, new.filial_id, new.id, v_man, v_desc)
  on conflict (veiculo_id) where liberado_em is null do nothing;

  return null;
end;
$$;

create constraint trigger checklists_avaria_critica
  after insert on public.checklists
  deferrable initially deferred
  for each row execute function private.checklist_avaria_critica();

-- -----------------------------------------------------------------------------
-- 4. CONCLUIR A MANUTENÇÃO LIBERA O VEÍCULO
-- -----------------------------------------------------------------------------
create or replace function private.manutencao_situacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.situacao = 'concluida' and new.situacao = 'aberta' then
    raise exception 'Uma manutenção concluída não pode ser reaberta' using errcode = '23514';
  end if;
  if old.situacao = 'aberta' and new.situacao = 'concluida' then
    new.concluida_em  := now();
    new.concluida_por := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger manutencoes_situacao
  before update of situacao on public.manutencoes
  for each row execute function private.manutencao_situacao();

create or replace function private.manutencao_libera_veiculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.veiculo_bloqueios
     set liberado_em = now(), liberado_por = (select auth.uid()), liberacao = 'conserto',
         liberacao_obs = 'Manutenção concluída'
   where manutencao_id = new.id and liberado_em is null;
  return null;
end;
$$;

create trigger manutencoes_libera_veiculo
  after update of situacao on public.manutencoes
  for each row
  when (old.situacao = 'aberta' and new.situacao = 'concluida')
  execute function private.manutencao_libera_veiculo();

-- -----------------------------------------------------------------------------
-- 5. LIBERAÇÃO PELO RESPONSÁVEL (supervisor da filial ou admin), com motivo
-- -----------------------------------------------------------------------------
create or replace function public.liberar_veiculo(p_veiculo_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filial uuid;
begin
  select v.filial_id into v_filial from public.veiculos v where v.id = p_veiculo_id;
  -- coalesce: para quem não é supervisor my_filial_id() é nulo, e "nulo" não pode autorizar
  if v_filial is null
     or not ((select private.is_admin()) or coalesce(v_filial = (select private.my_filial_id()), false)) then
    raise exception 'Somente o supervisor da filial ou o Administrador Geral libera o veículo' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo da liberação (mínimo 5 caracteres)' using errcode = '23514';
  end if;
  update public.veiculo_bloqueios
     set liberado_em = now(), liberado_por = (select auth.uid()), liberacao = 'responsavel',
         liberacao_obs = btrim(p_motivo)
   where veiculo_id = p_veiculo_id and liberado_em is null;
  if not found then
    raise exception 'O veículo já está liberado' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.checklist_avaria_critica()  from public;
revoke all on function private.manutencao_situacao()       from public;
revoke all on function private.manutencao_libera_veiculo() from public;
revoke all on function public.liberar_veiculo(uuid, text)  from public, anon;
grant execute on function public.liberar_veiculo(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. VIEW DO PAINEL (colunas novas sempre ao final)
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
  -- conserto pendente não "trata" a avaria: só a corretiva concluída
  (select max(m.data_manutencao)
     from public.manutencoes m
    where m.veiculo_id = v.id and m.tipo = 'corretiva' and m.situacao = 'concluida') as ultima_corretiva_em,
  (select m.id
     from public.manutencoes m
    where m.veiculo_id = v.id and m.tipo = 'preventiva'
    order by m.data_manutencao desc, m.created_at desc
    limit 1)                                                      as ultima_preventiva_id,
  v.motorista_id,
  mo.nome                                                         as motorista_nome,
  b.id                                                            as bloqueio_id,
  b.bloqueado_em,
  b.motivo                                                        as bloqueio_motivo,
  b.checklist_id                                                  as bloqueio_checklist_id,
  b.manutencao_id                                                 as bloqueio_manutencao_id,
  (select max(lb.liberado_em)
     from public.veiculo_bloqueios lb
    where lb.veiculo_id = v.id)                                   as ultima_liberacao_em,
  (select count(*)::integer
     from public.manutencoes ma
    where ma.veiculo_id = v.id and ma.situacao = 'aberta')        as manutencoes_abertas
from public.veiculos v
join public.filiais f on f.id = v.filial_id
left join public.motoristas mo on mo.id = v.motorista_id
left join public.veiculo_bloqueios b on b.veiculo_id = v.id and b.liberado_em is null
left join lateral (
  select ck.id, ck.status, ck.data_envio
    from public.checklists ck
   where ck.veiculo_id = v.id
   order by ck.data_envio desc
   limit 1
) c on true;
