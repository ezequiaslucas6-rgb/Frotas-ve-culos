-- =============================================================================
-- Checklist por tipo (diário, semanal, mensal) e fotos organizadas em grupos
--
--   1. Tipos de checklist
--   2. Catálogo de itens (fotos) com grupo, instrução e ordem
--   3. Modelos: quais itens cada tipo exige (o admin ajusta pelo app)
--   4. checklists.tipo + respostas das perguntas Sim/Não
--   5. checklist_fotos.categoria_foto passa a ser texto ligado ao catálogo
--   6. RPC salvar_checklist validando as fotos pelo modelo do tipo
--   7. RPC definir_modelo_checklist (somente admin)
--   8. Row Level Security
--
-- Itens "condicionais" (ex.: vazamento ou avaria) são uma pergunta Sim/Não: a foto
-- só é exigida quando a resposta é Sim.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TIPOS
-- -----------------------------------------------------------------------------
create type public.checklist_tipo as enum ('diario', 'semanal', 'mensal');

-- -----------------------------------------------------------------------------
-- 2. CATÁLOGO DE ITENS
-- -----------------------------------------------------------------------------
create table public.checklist_itens (
  codigo      text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome        text not null check (char_length(btrim(nome)) >= 2),
  grupo       text not null check (char_length(btrim(grupo)) >= 2),
  instrucao   text,
  pergunta    text,
  ordem       integer not null,
  condicional boolean not null default false,
  ativo       boolean not null default true,
  constraint checklist_itens_pergunta_chk check (not condicional or pergunta is not null)
);

insert into public.checklist_itens (codigo, nome, grupo, instrucao, ordem, condicional, pergunta, ativo) values
  -- Exterior
  ('frente',                  'Frente',                       'Exterior',        'Fotografe de frente, mostrando para-choque, capô e faróis.', 110, false, null, true),
  ('traseira',                'Traseira',                     'Exterior',        'De trás: para-choque, placa e lanternas.', 120, false, null, true),
  ('lateral_esquerda',        'Lateral esquerda',             'Exterior',        'Enquadre o veículo inteiro, do para-choque dianteiro ao traseiro.', 130, false, null, true),
  ('lateral_direita',         'Lateral direita',              'Exterior',        'Enquadre o veículo inteiro, do para-choque dianteiro ao traseiro.', 140, false, null, true),
  ('carroceria_portamalas',   'Carroceria ou porta-malas',    'Exterior',        'Aberto: limpeza, carga e amarração.', 150, false, null, true),
  ('luzes_sinalizacao',       'Luzes e sinalização',          'Exterior',        'Faróis, setas e lanternas acesos (peça ajuda para conferir).', 160, false, null, true),
  ('para_brisa',              'Para-brisa e palhetas',        'Exterior',        'Mostre o para-brisa e as palhetas; atenção a trincas e lascas.', 170, false, null, true),
  -- Pneus
  ('pneu_dianteiro_esquerdo', 'Pneu dianteiro esquerdo',      'Pneus',           'Enquadre o pneu inteiro com a banda de rodagem (sulcos) visível.', 210, false, null, true),
  ('pneu_dianteiro_direito',  'Pneu dianteiro direito',       'Pneus',           'Enquadre o pneu inteiro com a banda de rodagem (sulcos) visível.', 220, false, null, true),
  ('pneu_traseiro_esquerdo',  'Pneu traseiro esquerdo',       'Pneus',           'Enquadre o pneu inteiro com a banda de rodagem (sulcos) visível.', 230, false, null, true),
  ('pneu_traseiro_direito',   'Pneu traseiro direito',        'Pneus',           'Enquadre o pneu inteiro com a banda de rodagem (sulcos) visível.', 240, false, null, true),
  ('estepe',                  'Estepe',                       'Pneus',           'Mostre o estepe e a banda de rodagem.', 250, false, null, true),
  -- Retrovisores
  ('retrovisor_esquerdo',     'Retrovisor esquerdo',          'Retrovisores',    'Espelho e carcaça inteiros: sem trincas e bem fixados.', 310, false, null, true),
  ('retrovisor_direito',      'Retrovisor direito',           'Retrovisores',    'Espelho e carcaça inteiros: sem trincas e bem fixados.', 320, false, null, true),
  -- Motor e fluidos
  ('nivel_oleo',              'Nível de óleo do motor',       'Motor e fluidos', 'Retire a vareta, limpe, recoloque e fotografe com o nível visível entre as marcas.', 410, false, null, true),
  ('fluido_freio',            'Nível do fluido de freio',     'Motor e fluidos', 'Reservatório do fluido de freio com as marcas MIN e MAX visíveis.', 420, false, null, true),
  ('nivel_agua',              'Água do arrefecimento',        'Motor e fluidos', 'Reservatório de expansão (com o motor frio) e as marcas de nível visíveis.', 430, false, null, true),
  ('motor',                   'Compartimento do motor',       'Motor e fluidos', 'Capô aberto, enquadrando o motor: vazamentos, mangueiras e correias.', 440, false, null, true),
  -- Cabine
  ('painel',                  'Painel (KM e alertas)',        'Cabine',          'Com o veículo ligado: hodômetro, combustível e luzes de alerta legíveis.', 510, false, null, true),
  ('bancos',                  'Bancos',                       'Cabine',          'Foto visível dos bancos (motorista e passageiros): rasgos, sujeira e cintos.', 520, false, null, true),
  ('equipamentos',            'Equipamentos obrigatórios',    'Cabine',          'Triângulo, macaco e chave de roda.', 530, false, null, true),
  -- Avarias (pergunta Sim/Não)
  ('vazamento_avaria',        'Vazamento ou avaria',          'Avarias',         'Fotografe o vazamento ou a avaria e toque na foto para marcar o ponto.', 610, true,
     'O veículo tem algum vazamento ou avaria?', true),
  -- Itens da versão anterior (mantidos para o histórico; não entram em checklists novos)
  ('interior',                'Interior do veículo',          'Cabine',          null, 910, false, null, false),
  ('rodas',                   '4 rodas (pneus e aros)',       'Pneus',           null, 920, false, null, false),
  ('retrovisores',            'Retrovisores',                 'Retrovisores',    null, 930, false, null, false);

-- -----------------------------------------------------------------------------
-- 3. MODELOS (o que cada tipo exige)
-- Diário: o essencial antes de rodar. Semanal: + luzes, para-brisa, estepe e
-- carroceria. Mensal: + motor e equipamentos. Ajustável em Checklists -> Modelos.
-- -----------------------------------------------------------------------------
create table public.checklist_modelo (
  tipo public.checklist_tipo not null,
  item text not null references public.checklist_itens (codigo) on update cascade on delete cascade,
  primary key (tipo, item)
);

insert into public.checklist_modelo (tipo, item)
select t.tipo::public.checklist_tipo, i.item
  from (values ('diario'), ('semanal'), ('mensal')) as t (tipo)
 cross join unnest(array[
   'frente', 'traseira', 'lateral_esquerda', 'lateral_direita',
   'pneu_dianteiro_esquerdo', 'pneu_dianteiro_direito', 'pneu_traseiro_esquerdo', 'pneu_traseiro_direito',
   'retrovisor_esquerdo', 'retrovisor_direito',
   'nivel_oleo', 'fluido_freio', 'nivel_agua',
   'painel', 'bancos', 'vazamento_avaria'
 ]) as i (item)
union all
select t.tipo::public.checklist_tipo, i.item
  from (values ('semanal'), ('mensal')) as t (tipo)
 cross join unnest(array['luzes_sinalizacao', 'para_brisa', 'estepe', 'carroceria_portamalas']) as i (item)
union all
select 'mensal'::public.checklist_tipo, i.item
  from unnest(array['motor', 'equipamentos']) as i (item);

-- -----------------------------------------------------------------------------
-- 4. CHECKLISTS: tipo + respostas Sim/Não
-- -----------------------------------------------------------------------------
alter table public.checklists
  add column tipo      public.checklist_tipo not null default 'diario',
  add column respostas jsonb not null default '{}'::jsonb
    constraint checklists_respostas_chk check (jsonb_typeof(respostas) = 'object');

create index checklists_filial_tipo_data_idx on public.checklists (filial_id, tipo, data_envio desc);

-- -----------------------------------------------------------------------------
-- 5. FOTOS: categoria vira texto ligado ao catálogo (novos itens sem mexer em enum)
-- -----------------------------------------------------------------------------
drop function if exists public.salvar_checklist(uuid, uuid, uuid, text, integer, jsonb);

alter table public.checklist_fotos
  alter column categoria_foto type text using categoria_foto::text;
alter table public.checklist_fotos
  add constraint checklist_fotos_item_fk foreign key (categoria_foto)
    references public.checklist_itens (codigo) on update cascade on delete restrict;

drop type public.categoria_foto;

-- -----------------------------------------------------------------------------
-- 6. RPC ATÔMICA: salvar_checklist
-- Valida as fotos pelo modelo do tipo (uma por item; itens condicionais só com
-- resposta Sim) e grava checklist + fotos + KM numa transação.
-- SECURITY INVOKER: toda a RLS continua valendo para quem chama.
-- -----------------------------------------------------------------------------
create or replace function public.salvar_checklist(
  p_id           uuid,
  p_tipo         public.checklist_tipo,
  p_veiculo_id   uuid,
  p_motorista_id uuid,
  p_observacoes  text,
  p_km           integer,
  p_fotos        jsonb,
  p_respostas    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_filial       uuid;
  v_rotulo       text := case p_tipo when 'diario' then 'diário' else p_tipo::text end;
  v_obrigatorios text[];
  v_condicionais text[];
  v_esperados    text[];
  v_enviados     text[];
  v_respostas    jsonb := '{}'::jsonb;
  v_item         text;
  v_status       public.checklist_status;
begin
  select v.filial_id into v_filial from public.veiculos v where v.id = p_veiculo_id;
  if v_filial is null then
    raise exception 'Veículo não encontrado ou sem permissão de acesso' using errcode = '42501';
  end if;

  select coalesce(array_agg(i.codigo order by i.ordem) filter (where not i.condicional), '{}'),
         coalesce(array_agg(i.codigo order by i.ordem) filter (where i.condicional), '{}')
    into v_obrigatorios, v_condicionais
    from public.checklist_modelo m
    join public.checklist_itens i on i.codigo = m.item
   where m.tipo = p_tipo and i.ativo;
  if cardinality(v_obrigatorios) = 0 then
    raise exception 'O checklist % não tem fotos configuradas', v_rotulo using errcode = '23514';
  end if;

  -- perguntas Sim/Não: todas respondidas; a foto entra só quando a resposta é Sim
  v_esperados := v_obrigatorios;
  foreach v_item in array v_condicionais loop
    if jsonb_typeof(coalesce(p_respostas, '{}'::jsonb) -> v_item) is distinct from 'boolean' then
      raise exception 'Responda a pergunta "%" (Sim ou Não)',
        (select coalesce(i.pergunta, i.nome) from public.checklist_itens i where i.codigo = v_item)
        using errcode = '23514';
    end if;
    v_respostas := v_respostas || jsonb_build_object(v_item, (p_respostas ->> v_item)::boolean);
    if (p_respostas ->> v_item)::boolean then
      v_esperados := v_esperados || v_item;
    end if;
  end loop;

  if jsonb_typeof(p_fotos) is distinct from 'array' then
    raise exception 'Fotos do checklist inválidas' using errcode = '23514';
  end if;
  select coalesce(array_agg(f ->> 'categoria_foto'), '{}') into v_enviados from jsonb_array_elements(p_fotos) f;
  if cardinality(v_enviados) <> cardinality(v_esperados)
     or (select count(distinct x) from unnest(v_enviados) x) <> cardinality(v_esperados)
     or not (v_enviados <@ v_esperados) then
    raise exception 'O checklist % exige % foto(s), uma por item', v_rotulo, cardinality(v_esperados)
      using errcode = '23514';
  end if;

  -- a foto de um vazamento/avaria declarado não pode ficar como "conforme"
  if exists (
    select 1 from jsonb_array_elements(p_fotos) f
     where f ->> 'categoria_foto' = any (v_condicionais) and coalesce(f ->> 'severidade', 'ok') = 'ok'
  ) then
    raise exception 'Classifique o vazamento ou a avaria como Atenção ou Avaria' using errcode = '23514';
  end if;

  select case
           when bool_or(coalesce(f ->> 'severidade', 'ok') = 'critico') then 'critico'
           when bool_or(coalesce(f ->> 'severidade', 'ok') = 'atencao') then 'atencao'
           else 'ok'
         end::public.checklist_status
    into v_status
    from jsonb_array_elements(p_fotos) f;

  insert into public.checklists
    (id, tipo, veiculo_id, motorista_id, filial_id, observacoes_gerais, status, km_registro, respostas)
  values
    (p_id, p_tipo, p_veiculo_id, p_motorista_id, v_filial, nullif(btrim(p_observacoes), ''), v_status, p_km, v_respostas);

  insert into public.checklist_fotos
    (checklist_id, categoria_foto, foto_url, observacao, severidade, marcadores)
  select p_id,
         f ->> 'categoria_foto',
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

revoke all on function public.salvar_checklist(uuid, public.checklist_tipo, uuid, uuid, text, integer, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_checklist(uuid, public.checklist_tipo, uuid, uuid, text, integer, jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPC definir_modelo_checklist: troca a lista de itens de um tipo (admin)
-- -----------------------------------------------------------------------------
create or replace function public.definir_modelo_checklist(p_tipo public.checklist_tipo, p_itens text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Somente o Administrador Geral altera os modelos de checklist' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_itens, '{}')) x
     where not exists (select 1 from public.checklist_itens i where i.codigo = x and i.ativo)
  ) then
    raise exception 'Item de checklist inválido' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.checklist_itens i where i.codigo = any (p_itens) and i.ativo and not i.condicional
  ) then
    raise exception 'O checklist precisa de ao menos uma foto obrigatória' using errcode = '23514';
  end if;

  delete from public.checklist_modelo where tipo = p_tipo;
  insert into public.checklist_modelo (tipo, item)
  select distinct p_tipo, x from unnest(p_itens) x;
end;
$$;

revoke all on function public.definir_modelo_checklist(public.checklist_tipo, text[]) from public, anon;
grant execute on function public.definir_modelo_checklist(public.checklist_tipo, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY: todos os logados leem o catálogo e os modelos; só o admin altera
-- -----------------------------------------------------------------------------
alter table public.checklist_itens  enable row level security;
alter table public.checklist_modelo enable row level security;
revoke all on public.checklist_itens, public.checklist_modelo from anon;

create policy checklist_itens_select on public.checklist_itens for select to authenticated using (true);
create policy checklist_itens_admin_insert on public.checklist_itens for insert to authenticated
  with check ((select private.is_admin()));
create policy checklist_itens_admin_update on public.checklist_itens for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy checklist_itens_admin_delete on public.checklist_itens for delete to authenticated
  using ((select private.is_admin()));

create policy checklist_modelo_select on public.checklist_modelo for select to authenticated using (true);
create policy checklist_modelo_admin_insert on public.checklist_modelo for insert to authenticated
  with check ((select private.is_admin()));
create policy checklist_modelo_admin_delete on public.checklist_modelo for delete to authenticated
  using ((select private.is_admin()));
