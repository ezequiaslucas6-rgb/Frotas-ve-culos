-- =============================================================================
-- Motorista: CPF, WhatsApp e CNH passam a ser opcionais no banco.
-- Fase de testes: a empresa não quer cadastrar dados reais dos motoristas ainda.
-- A obrigatoriedade fica no sistema (MOTORISTA_DADOS_OBRIGATORIOS=1 no .env a religa);
-- quando preenchidos, os formatos continuam conferidos pelos CHECKs abaixo (já existentes).
-- Idempotente: pode rodar de novo.
-- =============================================================================
alter table public.motoristas
  alter column cpf drop not null,
  alter column whatsapp drop not null,
  alter column cnh drop not null;
