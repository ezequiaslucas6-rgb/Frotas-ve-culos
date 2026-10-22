-- =============================================================================
-- Ordem das fotos do checklist: primeiro tudo EXTERNO, lado a lado; o INTERNO por último.
--
--   1. Exterior        frente, traseira, para-brisa, luzes, carroceria/porta-malas, estepe
--   2. Lado direito    lateral, pneu dianteiro, retrovisor (espelho e carcaça), pneu traseiro
--   3. Lado esquerdo   lateral, pneu dianteiro, retrovisor (espelho e carcaça), pneu traseiro
--   4. Motor e fluidos (capô aberto)
--   5. Cabine          painel (KM), bancos, equipamentos
--   6. Avarias         pergunta Sim/Não
--
-- Antes os pneus (esquerdo, direito, esquerdo, direito) e os retrovisores vinham em grupos
-- separados e o motorista ia e voltava pelo lado do veículo. Só muda ordem e grupo: os
-- checklists já feitos continuam iguais (as fotos são ligadas ao item pelo código).
-- Os itens da versão anterior (inativos) ficam como estão. Idempotente.
-- =============================================================================
update public.checklist_itens i
   set grupo = n.grupo, ordem = n.ordem
  from (values
    ('frente',                       'Exterior',      110),
    ('traseira',                     'Exterior',      120),
    ('para_brisa',                   'Exterior',      130),
    ('luzes_sinalizacao',            'Exterior',      140),
    ('carroceria_portamalas',        'Exterior',      150),
    ('estepe',                       'Exterior',      160),

    ('lateral_direita',              'Lado direito',  210),
    ('pneu_dianteiro_direito',       'Lado direito',  220),
    ('retrovisor_direito',           'Lado direito',  230),
    ('retrovisor_direito_carcaca',   'Lado direito',  240),
    ('pneu_traseiro_direito',        'Lado direito',  250),

    ('lateral_esquerda',             'Lado esquerdo', 310),
    ('pneu_dianteiro_esquerdo',      'Lado esquerdo', 320),
    ('retrovisor_esquerdo',          'Lado esquerdo', 330),
    ('retrovisor_esquerdo_carcaca',  'Lado esquerdo', 340),
    ('pneu_traseiro_esquerdo',       'Lado esquerdo', 350)
  ) as n (codigo, grupo, ordem)
 where i.codigo = n.codigo;
