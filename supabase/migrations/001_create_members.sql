create table if not exists public.members (
  id text primary key,
  name text not null check (char_length(name) between 2 and 80),
  username text not null unique,
  role text not null check (role in ('user', 'admin')),
  credits integer not null default 0 check (credits >= 0 and credits <= 1000000),
  status text not null check (status in ('active', 'suspended', 'expired')),
  last_login_at timestamptz,
  last_credit_deducted_on date,
  suspended_at timestamptz,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

revoke all on table public.members from anon, authenticated;
grant all on table public.members to service_role;
