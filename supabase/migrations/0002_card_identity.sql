-- Store only the issuer and the last four digits identified in a statement.
alter table public.cards add column if not exists issuer text not null default 'Itaú';
alter table public.cards add column if not exists last4 text check (last4 is null or last4 ~ '^\d{4}$');
create unique index if not exists cards_master_issuer_last4_idx on public.cards (master_id, issuer, last4) where last4 is not null;