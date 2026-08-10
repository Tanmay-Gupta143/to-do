create table if not exists public.study_data (
  member_id text primary key references public.members(id) on delete cascade,
  data jsonb not null default '{"records":{},"reminderTime":"20:00","displayName":"Tanmay"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_study_data_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists study_data_updated_at on public.study_data;
create trigger study_data_updated_at
before update on public.study_data
for each row execute function public.set_study_data_updated_at();

alter table public.study_data enable row level security;
revoke all on table public.study_data from anon, authenticated;
revoke all on table public.study_data from service_role;
grant select, insert, update on table public.study_data to service_role;

drop policy if exists "No direct study data access" on public.study_data;
create policy "No direct study data access"
on public.study_data
for all
to anon, authenticated
using (false)
with check (false);
