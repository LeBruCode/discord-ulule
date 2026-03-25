begin;

create table if not exists public.ulule_imports (
  id bigint generated always as identity primary key,
  email text not null,
  order_id bigint not null,
  reward_id bigint not null,
  reward_name text null,
  order_created_at timestamp with time zone null,
  access_token_id uuid null references public.access_tokens(id) on delete set null,
  outcome text not null default 'discovered',
  last_error text null,
  created_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now()
);

create unique index if not exists ulule_imports_order_reward_email_uidx
  on public.ulule_imports (order_id, reward_id, email);

create index if not exists ulule_imports_created_at_idx
  on public.ulule_imports (created_at desc);

create index if not exists ulule_imports_last_seen_at_idx
  on public.ulule_imports (last_seen_at desc);

create index if not exists ulule_imports_email_idx
  on public.ulule_imports (email);

alter table public.ulule_imports enable row level security;
revoke all on table public.ulule_imports from anon, authenticated;

commit;
