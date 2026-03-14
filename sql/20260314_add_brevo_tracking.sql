alter table public.access_tokens
  add column if not exists brevo_message_id text null,
  add column if not exists brevo_status text null,
  add column if not exists brevo_event_at timestamp with time zone null;

create index if not exists access_tokens_brevo_message_id_idx
  on public.access_tokens (brevo_message_id);

create index if not exists access_tokens_brevo_status_idx
  on public.access_tokens (brevo_status);
