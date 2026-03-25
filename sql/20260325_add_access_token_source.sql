begin;

alter table public.access_tokens
  add column if not exists import_source text;

update public.access_tokens
set import_source = 'manual'
where import_source is null;

update public.access_tokens at
set import_source = 'ulule'
from public.ulule_imports ui
where ui.access_token_id = at.id
  and at.import_source <> 'ulule';

alter table public.access_tokens
  alter column import_source set default 'manual';

alter table public.access_tokens
  add constraint access_tokens_import_source_check
  check (import_source in ('manual', 'ulule')) not valid;

alter table public.access_tokens
  validate constraint access_tokens_import_source_check;

create index if not exists access_tokens_import_source_idx
  on public.access_tokens (import_source);

commit;
