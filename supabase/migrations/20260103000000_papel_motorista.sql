-- =============================================================================
-- Novo papel de acesso: motorista
--
-- Fica sozinho neste arquivo de propósito: o PostgreSQL só permite USAR um valor
-- novo de enum depois que a transação que o criou terminou. Execute este arquivo
-- e, em seguida (outra execução), 20260103000100_motoristas_acesso.sql.
-- =============================================================================
alter type public.user_role add value if not exists 'motorista';
