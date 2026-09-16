-- ShareCard: make relational transactions addressable from the organizer state.
alter table public.transactions add column if not exists source_id text;
alter table public.transactions add column if not exists source_updated_at timestamptz not null default now();

update public.transactions
set source_id = id::text
where source_id is null;

alter table public.transactions alter column source_id set not null;

create unique index if not exists transactions_statement_source_idx
on public.transactions (statement_id, source_id);
