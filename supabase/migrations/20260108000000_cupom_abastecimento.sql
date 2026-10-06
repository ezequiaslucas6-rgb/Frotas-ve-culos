-- =============================================================================
-- Nota de abastecimento: valor total, desconto e leitura automática do cupom
--
-- O cupom mostra o valor total e o desconto, mas não o preço por litro com desconto.
--   valor_bruto    valor total do combustível no cupom (antes do desconto)
--   desconto       desconto do combustível
--   valor_total    valor LÍQUIDO = valor_bruto − desconto (o que foi pago; entra nos custos)
--   preco_litro    gerado: valor_total ÷ litros = preço por litro COM desconto
--   leitura_cupom  o que a leitura da foto (IA) encontrou, para conferência
--
-- Lançamentos antigos: valor_bruto vazio e desconto 0 (valor_total já era o valor pago).
-- Rodar uma vez no SQL Editor (depois da 20260107).
-- =============================================================================

alter table public.abastecimentos
  add column if not exists valor_bruto   numeric(12, 2),
  add column if not exists desconto      numeric(12, 2) not null default 0,
  add column if not exists leitura_cupom jsonb;

alter table public.abastecimentos
  drop constraint if exists abastecimentos_desconto_ck,
  drop constraint if exists abastecimentos_leitura_ck;

alter table public.abastecimentos
  -- sem valor total informado não há desconto; com ele, líquido = total − desconto (centavo a centavo).
  -- (o "is not null" evita que um NULL no meio da conta faça a regra passar)
  add constraint abastecimentos_desconto_ck check (
    (valor_bruto is null and desconto = 0)
    or (valor_bruto is not null and valor_bruto > 0 and desconto >= 0 and desconto < valor_bruto
        and valor_total = valor_bruto - desconto)
  ),
  add constraint abastecimentos_leitura_ck check (
    leitura_cupom is null or (jsonb_typeof(leitura_cupom) = 'object' and pg_column_size(leitura_cupom) <= 8192)
  );

comment on column public.abastecimentos.valor_bruto is 'Valor total do combustível no cupom, antes do desconto';
comment on column public.abastecimentos.desconto is 'Desconto do combustível (valor_total = valor_bruto − desconto)';
comment on column public.abastecimentos.valor_total is 'Valor líquido pago pelo combustível';
comment on column public.abastecimentos.leitura_cupom is 'Valores lidos da foto do cupom pela leitura automática (conferência)';
