-- =============================================================================
-- Folga do motorista: dias da semana em que ele não trabalha (0 = domingo … 6 = sábado).
-- Ex.: o veículo para na sexta e só volta na segunda => folga sexta, sábado e domingo.
-- Nos dias de folga o veículo do motorista não gera checklist diário pendente; com sábado
-- E domingo de folga, o semanal do fim de semana também não é cobrado (o veículo não
-- fica "não liberado" na segunda). Quem decide é o sistema (src/lib/checklist/cobranca.ts):
-- o banco só guarda os dias e os entrega no painel. Idempotente.
-- =============================================================================
alter table public.motoristas
  add column if not exists dias_folga smallint[] not null default '{}';

alter table public.motoristas drop constraint if exists motoristas_dias_folga_chk;
alter table public.motoristas
  add constraint motoristas_dias_folga_chk
  check (dias_folga <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(dias_folga) <= 7);

-- view do painel: coluna nova sempre ao final
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
  ld.observacao                                                   as liberacao_diaria_obs,
  -- dias de folga do motorista responsável (0 = domingo … 6 = sábado): sem checklist cobrado nesses dias
  mo.dias_folga                                                   as motorista_dias_folga
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
