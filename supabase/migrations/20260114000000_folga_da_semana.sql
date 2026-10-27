-- =============================================================================
-- Folga da semana (revezamento de plantão): substitui os "dias de folga" fixos da migration 20260112.
--
-- O supervisor toca em "Folga da semana" no perfil do motorista e ele fica de folga na SEXTA, no
-- SÁBADO e no DOMINGO daquela semana. Cada folga é guardada pela data da sexta-feira que a abre
-- (folgas_fim_semana) e acaba sozinha no domingo: na segunda o motorista volta, sem desmarcar.
-- O sistema guarda só as folgas recentes (o semanal do fim de semana de folga fica dispensado
-- até o próximo ciclo). Quem decide é src/lib/checklist/cobranca.ts; o banco guarda as datas e
-- as entrega no painel. Serve para quem já rodou a 20260112 e para quem não rodou. Idempotente.
-- =============================================================================
alter table public.motoristas
  add column if not exists folgas_fim_semana date[] not null default '{}';

alter table public.motoristas drop constraint if exists motoristas_folgas_chk;
alter table public.motoristas
  add constraint motoristas_folgas_chk check (cardinality(folgas_fim_semana) <= 60);

-- a view usa a coluna antiga: solta, tira a coluna e recria (colunas novas sempre ao final)
drop view if exists public.vw_veiculos_painel;

alter table public.motoristas drop constraint if exists motoristas_dias_folga_chk;
alter table public.motoristas drop column if exists dias_folga;

create view public.vw_veiculos_painel
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
  -- folgas da semana do motorista responsável: a sexta que abre cada fim de semana de folga (sex, sáb e dom)
  mo.folgas_fim_semana                                            as motorista_folgas
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

revoke all on public.vw_veiculos_painel from anon;
grant select on public.vw_veiculos_painel to authenticated;
