-- =============================================================================
-- Seed inicial (executar UMA vez, depois da migration, no SQL Editor do Supabase)
-- =============================================================================

-- 1) Filiais de exemplo (ajuste para a sua operação)
insert into public.filiais (nome_cidade, uf) values
  ('São Paulo', 'SP'),
  ('Rio de Janeiro', 'RJ'),
  ('Belo Horizonte', 'MG')
on conflict do nothing;

-- 2) Primeiro Administrador Geral
--    a) Crie o usuário em Authentication > Users > "Add user" (e-mail + senha, "Auto Confirm User").
--    b) Troque o e-mail abaixo pelo e-mail criado e execute:
--
-- insert into public.profiles (id, nome, role, filial_id)
-- select id, 'Administrador Geral', 'admin', null
--   from auth.users
--  where email = 'admin@suaempresa.com.br';
--
-- Os supervisores são criados depois, pela própria aplicação (menu "Supervisores").
