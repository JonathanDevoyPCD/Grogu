-- Dedicated Supabase project only: all data is shared among approved Grogu members.
create table public.grogu_members (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  email text not null unique,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table public.grogu_projects (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 500),
  domain text not null default '' check (char_length(domain) <= 500),
  stage_url text not null default '' check (char_length(stage_url) <= 500),
  host text not null default '' check (char_length(host) <= 500),
  launch_date text not null default '' check (launch_date = '' or launch_date ~ '^\d{4}-\d{2}-\d{2}$'),
  notes text not null default '' check (char_length(notes) <= 5000),
  designer_id uuid references public.grogu_members(id) on delete set null,
  developer_id uuid references public.grogu_members(id) on delete set null,
  tester_id uuid references public.grogu_members(id) on delete set null,
  account_id uuid references public.grogu_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grogu_items (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.grogu_projects(id) on delete cascade,
  section text not null check (char_length(section) between 1 and 255),
  title text not null check (char_length(title) between 1 and 500),
  position integer not null check (position >= 0),
  notes text not null default '' check (char_length(notes) <= 5000),
  designer boolean not null default false,
  developer boolean not null default false,
  content_admin boolean not null default false,
  tester boolean not null default false,
  account_exec boolean not null default false,
  not_applicable boolean not null default false,
  unique(project_id, position)
);

create schema if not exists grogu_private;
revoke all on schema grogu_private from public, anon, authenticated;

create function grogu_private.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.grogu_members where id = (select auth.uid())) $$;

revoke all on function grogu_private.is_member() from public;
grant usage on schema grogu_private to authenticated;
grant execute on function grogu_private.is_member() to authenticated;

alter table public.grogu_members enable row level security;
alter table public.grogu_projects enable row level security;
alter table public.grogu_items enable row level security;
revoke all on public.grogu_members, public.grogu_projects, public.grogu_items from public, anon, authenticated;
grant select on public.grogu_members to authenticated;
grant select, delete on public.grogu_projects to authenticated;
grant update (name, domain, stage_url, host, launch_date, notes, designer_id, developer_id, tester_id, account_id) on public.grogu_projects to authenticated;
grant select on public.grogu_items to authenticated;
grant update (notes, designer, developer, content_admin, tester, account_exec, not_applicable) on public.grogu_items to authenticated;
create policy member_read on public.grogu_members for select to authenticated using ((select grogu_private.is_member()));
create policy project_read on public.grogu_projects for select to authenticated using ((select grogu_private.is_member()));
create policy project_update on public.grogu_projects for update to authenticated using ((select grogu_private.is_member())) with check ((select grogu_private.is_member()));
create policy project_delete on public.grogu_projects for delete to authenticated using ((select grogu_private.is_member()));
create policy item_read on public.grogu_items for select to authenticated using ((select grogu_private.is_member()));
create policy item_update on public.grogu_items for update to authenticated using ((select grogu_private.is_member())) with check ((select grogu_private.is_member()));

create function grogu_private.touch_project() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'grogu_projects' then
    new.updated_at := now();
    return new;
  end if;
  update public.grogu_projects set updated_at = now() where id = new.project_id;
  return new;
end $$;
create trigger grogu_project_touch before update on public.grogu_projects for each row execute function grogu_private.touch_project();
create trigger grogu_item_touch after update on public.grogu_items for each row execute function grogu_private.touch_project();

create function public.grogu_create_project(details jsonb, checks jsonb)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare project_id bigint; entry jsonb; position integer := 0;
begin
  if not grogu_private.is_member() then raise exception 'Not a member' using errcode = '42501'; end if;
  if jsonb_typeof(checks) <> 'array' or jsonb_array_length(checks) < 1 or jsonb_array_length(checks) > 200 then
    raise exception 'Invalid checklist';
  end if;
  insert into public.grogu_projects(name, domain, stage_url, host, launch_date, notes, designer_id, developer_id, tester_id, account_id)
  values (details->>'name', coalesce(details->>'domain', ''), coalesce(details->>'stage_url', ''),
    coalesce(details->>'host', ''), coalesce(details->>'launch_date', ''), coalesce(details->>'notes', ''),
    nullif(details->>'designer_id', '')::uuid, nullif(details->>'developer_id', '')::uuid,
    nullif(details->>'tester_id', '')::uuid, nullif(details->>'account_id', '')::uuid)
  returning id into project_id;
  for entry in select * from jsonb_array_elements(checks) loop
    insert into public.grogu_items(project_id, section, title, position)
    values (project_id, entry->>'section', entry->>'title', position);
    position := position + 1;
  end loop;
  return project_id;
end $$;
revoke all on function public.grogu_create_project(jsonb, jsonb) from public, anon;
grant execute on function public.grogu_create_project(jsonb, jsonb) to authenticated;
