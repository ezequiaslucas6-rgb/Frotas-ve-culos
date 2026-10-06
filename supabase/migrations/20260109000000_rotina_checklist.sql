-- =============================================================================
-- Rotina dos checklists (horário de Pimenta Bueno/RO) e carcaça dos retrovisores
-- =============================================================================
--   1. horário do negócio: America/Porto_Velho (Rondônia, UTC−4, sem horário de verão);
--   2. checklist diário NÃO é obrigatório: às 08:30 o supervisor vê quem fez e decide,
--      para cada veículo sem checklist, se ele está liberado para uso hoje
--      (liberacoes_diarias + RPC decidir_liberacao_diaria). "Não liberado" vale até o
--      veículo fazer o checklist do dia;
--   3. checklist semanal é obrigatório no sábado ou no domingo: sem ele, o veículo fica
--      "não liberado" de segunda até fazer (regra calculada no app, a partir das colunas
--      novas da view do painel);
--   4. fotos obrigatórias da carcaça (parte de trás) dos dois retrovisores;
--   5. view do painel com o último semanal/mensal e a decisão diária de hoje.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. HORÁRIO: avaria crítica descrita e datada no horário de Pimenta Bueno
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
                   to_char(new.data_envio at time zone 'America/Porto_Velho', 'DD/MM/YYYY'),
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
       (now() at time zone 'America/Porto_Velho')::date, 'aberta', new.id, new.supervisor_id)
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

revoke all on function private.checklist_avaria_critica() from public;

-- -----------------------------------------------------------------------------
-- 2. DECISÃO DIÁRIA (veículo sem checklist diário até 08:30)
-- -----------------------------------------------------------------------------
create table public.liberacoes_diarias (
  veiculo_id   uuid not null,
  filial_id    uuid not null,
  dia          date not null,
  liberado     boolean not null,
  observacao   text check (observacao is null or char_length(observacao) <= 300),
  decidido_por uuid references public.profiles (id) on delete set null,
  decidido_em  timestamptz not null default now(),
  primary key (veiculo_id, dia),
  constraint liberacoes_diarias_veiculo_fk foreign key (veiculo_id, filial_id)
    references public.veiculos (id, filial_id) on delete cascade
);
create index liberacoes_diarias_filial_dia_idx on public.liberacoes_diarias (filial_id, dia);

alter table public.liberacoes_diarias enable row level security;
revoke all on public.liberacoes_diarias from anon;
-- leitura: admin, supervisor da filial e o motorista responsável. Escrita só pela RPC.
create policy liberacoes_diarias_select on public.liberacoes_diarias for select to authenticated
  using (
    (select private.is_admin())
    or filial_id = (select private.my_filial_id())
    or array[veiculo_id] <@ (select private.meus_veiculos())
  );

create or replace function public.decidir_liberacao_diaria(p_veiculo_id uuid, p_liberado boolean, p_observacao text default null)
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
    raise exception 'Somente o supervisor da filial ou o Administrador Geral decide a liberação' using errcode = '42501';
  end if;
  if p_liberado is null then
    raise exception 'Informe se o veículo está liberado' using errcode = '23514';
  end if;
  insert into public.liberacoes_diarias (veiculo_id, filial_id, dia, liberado, observacao, decidido_por, decidido_em)
  values (p_veiculo_id, v_filial, (now() at time zone 'America/Porto_Velho')::date, p_liberado,
          nullif(btrim(left(coalesce(p_observacao, ''), 300)), ''), (select auth.uid()), now())
  on conflict (veiculo_id, dia) do update
     set liberado = excluded.liberado, observacao = excluded.observacao,
         decidido_por = excluded.decidido_por, decidido_em = excluded.decidido_em;
end;
$$;

revoke all on function public.decidir_liberacao_diaria(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_liberacao_diaria(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. CARCAÇA DOS RETROVISORES (foto da parte de trás, nos três tipos)
-- -----------------------------------------------------------------------------
insert into public.checklist_itens (codigo, nome, grupo, instrucao, ordem, condicional, pergunta, ativo) values
  ('retrovisor_esquerdo_carcaca', 'Retrovisor esquerdo: carcaça', 'Retrovisores',
     'Por trás do retrovisor: a carcaça inteira, sem trincas, quebras ou remendos, e bem fixada.', 315, false, null, true),
  ('retrovisor_direito_carcaca',  'Retrovisor direito: carcaça',  'Retrovisores',
     'Por trás do retrovisor: a carcaça inteira, sem trincas, quebras ou remendos, e bem fixada.', 325, false, null, true)
on conflict (codigo) do nothing;

update public.checklist_itens set instrucao = 'De frente para o espelho: sem trincas, limpo e bem regulado.'
 where codigo in ('retrovisor_esquerdo', 'retrovisor_direito');

insert into public.checklist_modelo (tipo, item)
select t.tipo::public.checklist_tipo, i.item
  from (values ('diario'), ('semanal'), ('mensal')) as t (tipo)
 cross join unnest(array['retrovisor_esquerdo_carcaca', 'retrovisor_direito_carcaca']) as i (item)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 5. VIEW DO PAINEL (colunas novas sempre ao final)
-- -----------------------------------------------------------------------------
create index if not exists checklists_veiculo_tipo_data_idx on public.checklists (veiculo_id, tipo, data_envio desc);

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
    where ma.veiculo_id = v.id and ma.situacao = 'aberta')        as manutencoes_abertas,
  -- o mensal cobre o semanal (o modelo do mensal tem as fotos do semanal)
  (select max(cs.data_envio)
     from public.checklists cs
    where cs.veiculo_id = v.id and cs.tipo in ('semanal', 'mensal')) as ultimo_semanal_em,
  (select max(cm.data_envio)
     from public.checklists cm
    where cm.veiculo_id = v.id and cm.tipo = 'mensal')            as ultimo_mensal_em,
  ld.liberado                                                     as liberacao_diaria,
  ld.decidido_em                                                  as liberacao_diaria_em,
  ld.observacao                                                   as liberacao_diaria_obs
from public.veiculos v
join public.filiais f on f.id = v.filial_id
left join public.motoristas mo on mo.id = v.motorista_id
left join public.veiculo_bloqueios b on b.veiculo_id = v.id and b.liberado_em is null
left join public.liberacoes_diarias ld
  on ld.veiculo_id = v.id and ld.dia = (now() at time zone 'America/Porto_Velho')::date
left join lateral (
  select ck.id, ck.status, ck.data_envio
    from public.checklists ck
   where ck.veiculo_id = v.id
   order by ck.data_envio desc
   limit 1
) c on true;
