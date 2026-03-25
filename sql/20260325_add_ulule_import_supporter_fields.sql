begin;

alter table public.ulule_imports
  add column if not exists supporter_first_name text null,
  add column if not exists supporter_last_name text null,
  add column if not exists supporter_full_name text null;

commit;
