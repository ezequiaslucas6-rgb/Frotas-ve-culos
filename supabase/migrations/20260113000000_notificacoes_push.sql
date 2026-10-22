-- =============================================================================
-- Notificações por push: o SERVIDOR avisa na hora certa (08:00 motorista, 08:30 supervisor).
--
--   push_dispositivos  onde entregar: navegador (Web Push, PC/Android) ou o APK (FCM).
--                      Um usuário pode ter vários aparelhos. O mesmo aparelho (destino) é
--                      de um usuário só: quem entra depois assume o aparelho.
--   push_disparos      um registro por horário e dia: garante que o lembrete sai UMA vez
--                      (o agendador do servidor roda todo minuto e pode repetir/reiniciar).
--
-- Só o servidor (service role) lê e grava: nenhuma política para anon/authenticated.
-- Idempotente.
-- =============================================================================
create table if not exists public.push_dispositivos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  tipo           text not null check (tipo in ('web', 'fcm')),
  -- web: endereço da assinatura do navegador; fcm: token do aparelho
  destino        text not null unique check (char_length(destino) between 20 and 4000),
  chave_p256dh   text,
  chave_auth     text,
  user_agent     text check (char_length(user_agent) <= 300),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  ultimo_envio_em timestamptz,
  constraint push_dispositivos_web_chaves_chk check (tipo <> 'web' or (chave_p256dh is not null and chave_auth is not null))
);
create index if not exists push_dispositivos_user_idx on public.push_dispositivos (user_id);

create table if not exists public.push_disparos (
  momento      text not null check (momento in ('0800', '0830')),
  dia          date not null,
  iniciado_em  timestamptz not null default now(),
  concluido_em timestamptz,
  enviados     integer not null default 0,
  primary key (momento, dia)
);

alter table public.push_dispositivos enable row level security;
alter table public.push_disparos enable row level security;
revoke all on public.push_dispositivos, public.push_disparos from anon, authenticated;
