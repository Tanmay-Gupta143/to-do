alter table public.members
  add column if not exists suspension_reason text,
  add column if not exists suspension_until date,
  add column if not exists force_password_change boolean not null default false;

-- The application uses its server-only service-role client; browser roles retain no access.
alter table public.members enable row level security;
revoke all on table public.members from anon, authenticated;
grant all on table public.members to service_role;
