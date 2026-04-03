alter table public.game_rooms
  add column if not exists game_mode text not null default 'short' check (game_mode in ('short', 'long'));

alter table public.game_rooms
  add column if not exists game_state jsonb not null default '{}'::jsonb;
