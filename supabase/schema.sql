create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop table if exists public.game_actions cascade;
drop table if exists public.room_players cascade;
drop table if exists public.game_rooms cascade;
drop table if exists public.internal_users cascade;

create table public.internal_users (
  username text primary key,
  display_name text not null,
  password text not null,
  role text not null check (role in ('master', 'player')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  game_mode text not null default 'short' check (game_mode in ('short', 'long')),
  game_state jsonb not null default '{}'::jsonb,
  status text not null default 'waiting' check (status in ('waiting', 'running', 'finished')),
  turn_order text[] not null default '{}',
  current_turn_index integer not null default 0,
  winner_username text references public.internal_users(username),
  created_by text not null references public.internal_users(username),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create trigger trg_game_rooms_updated_at
before update on public.game_rooms
for each row execute function public.set_updated_at();

create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  username text not null references public.internal_users(username) on delete cascade,
  chips integer not null default 1 check (chips >= 0),
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_action_at timestamptz not null default now(),
  unique (room_id, username)
);

create table public.game_actions (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  actor_username text not null references public.internal_users(username),
  target_username text references public.internal_users(username),
  card_key text,
  description text not null,
  created_at timestamptz not null default now()
);

alter table public.internal_users enable row level security;
alter table public.game_rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.game_actions enable row level security;

create policy "internal_users_open_all" on public.internal_users
for all using (true) with check (true);

create policy "game_rooms_open_all" on public.game_rooms
for all using (true) with check (true);

create policy "room_players_open_all" on public.room_players
for all using (true) with check (true);

create policy "game_actions_open_all" on public.game_actions
for all using (true) with check (true);

insert into public.internal_users (username, display_name, password, role, active)
values
  ('mestre', 'Mestre', '123456', 'master', true),
  ('joao', 'Joao', '1234', 'player', true),
  ('milena', 'Milena', '1234', 'player', true),
  ('rayanne', 'Rayanne', '1234', 'player', true),
  ('daniel', 'Daniel', '1234', 'player', true),
  ('barbara', 'Barbara', '1234', 'player', true),
  ('weslley', 'Weslley', '1234', 'player', true)
on conflict (username) do update
set
  display_name = excluded.display_name,
  password = excluded.password,
  role = excluded.role,
  active = excluded.active;

with room_seed as (
  insert into public.game_rooms (name, created_by, game_mode, game_state, status, turn_order, current_turn_index)
  values ('Sessao Principal', 'mestre', 'short', '{}'::jsonb, 'waiting', '{}', 0)
  on conflict (name) do update
  set updated_at = now()
  returning id
)
insert into public.room_players (room_id, username, chips, is_ready)
select room_seed.id, user_seed.username, 1, false
from room_seed
cross join (
  select unnest(array['joao','milena','rayanne','daniel','barbara','weslley']) as username
) as user_seed
on conflict (room_id, username) do update
set chips = excluded.chips, is_ready = excluded.is_ready;

do $$
begin
  begin
    alter publication supabase_realtime add table public.game_rooms;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.room_players;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.game_actions;
  exception when duplicate_object then
    null;
  end;
end;
$$;

