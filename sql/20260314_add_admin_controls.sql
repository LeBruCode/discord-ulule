alter table public.access_tokens
  add column if not exists resend_excluded boolean not null default false,
  add column if not exists admin_note text null,
  add column if not exists admin_note_updated_at timestamp with time zone null;

create index if not exists access_tokens_resend_excluded_idx
  on public.access_tokens (resend_excluded);
