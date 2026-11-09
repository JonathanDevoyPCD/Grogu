insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.grogu_members(id, name, email, role) values ('11111111-1111-1111-1111-111111111111', 'Member', 'member@example.test', 'member');

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$
begin
  if (select count(*) from public.grogu_members) <> 0 then raise exception 'Non-member can see members'; end if;
  begin
    perform public.grogu_create_project('{"name":"blocked"}', '[{"section":"S","title":"T"}]');
    raise exception 'Non-member created project';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.grogu_create_project('{"name":"Test"}', '[{"section":"General","title":"Check"}]');
do $$
begin
  if (select count(*) from public.grogu_projects) <> 1 then raise exception 'Member cannot see project'; end if;
  update public.grogu_items set designer = true where position = 0;
  if not (select designer from public.grogu_items where position = 0) then raise exception 'Checklist update failed'; end if;
  begin
    update public.grogu_members set role = 'admin';
    raise exception 'Member elevated role';
  exception when insufficient_privilege then null; end;
  begin
    update public.grogu_items set title = 'Altered';
    raise exception 'Member changed protected item title';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.grogu_members where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
do $$
begin
  if (select count(*) from public.grogu_projects) <> 0 then raise exception 'Removed member can still read'; end if;
  update public.grogu_items set designer = false;
  if found then raise exception 'Removed member can still edit'; end if;
end $$;
reset role;
set role anon;
do $$
begin
  begin
    perform count(*) from public.grogu_projects;
    raise exception 'Anonymous read succeeded';
  exception when insufficient_privilege then null; end;
end $$;
