-- A buyer can exist before creating an account.  The email and invitation keep
-- the later account claim linked to that exact person instead of matching names.
alter table public.people add column if not exists email text;
alter table public.invitations add column if not exists person_id uuid references public.people(id) on delete set null;

create unique index if not exists people_master_email_idx
on public.people (master_id, lower(email)) where email is not null;

create index if not exists invitations_person_id_idx on public.invitations (person_id);
