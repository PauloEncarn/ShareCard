-- ShareCard: initial production schema for Supabase.
create type public.member_role as enum ('master', 'buyer');
create type public.transaction_kind as enum ('purchase', 'service');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  master_id uuid not null,
  role public.member_role not null,
  name text not null check (char_length(name) between 1 and 80),
  avatar_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_is_own_profile check ((role = 'master' and master_id = id) or role = 'buyer')
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  due_day smallint not null check (due_day between 1 and 31),
  created_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid unique references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default '#2563EB' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  monthly_limit_cents bigint check (monthly_limit_cents >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete restrict,
  due_date date not null,
  filename text not null,
  storage_path text not null unique,
  sha256 text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 15728640),
  fingerprint text not null,
  total_cents bigint not null,
  next_total_cents bigint,
  later_total_cents bigint,
  holder_totals jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  transaction_count integer not null default 0 check (transaction_count >= 0),
  version integer not null default 1 check (version > 0),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (card_id, due_date)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.statements(id) on delete cascade,
  master_id uuid not null references public.profiles(id) on delete cascade,
  transaction_date date not null,
  merchant text not null,
  cents bigint not null,
  holder text not null,
  category text not null,
  installment_current smallint,
  installment_total smallint,
  next_cents bigint,
  kind public.transaction_kind not null default 'purchase',
  buyer_id uuid references public.people(id) on delete set null,
  shared_cost boolean not null default false,
  carry_forward boolean not null default true,
  note text check (char_length(note) <= 2000),
  allocations jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  check ((installment_current is null and installment_total is null) or (installment_current between 1 and installment_total))
);

create table public.workspaces (
  master_id uuid primary key references public.profiles(id) on delete cascade,
  state jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create index cards_master_id_idx on public.cards(master_id);
create index people_master_id_idx on public.people(master_id);
create index statements_master_due_idx on public.statements(master_id, due_date desc);
create index transactions_statement_id_idx on public.transactions(statement_id);
create index transactions_master_id_idx on public.transactions(master_id);

-- All authorization starts from auth.uid(), never from an ID provided by the browser.
create function public.is_space_member(space_master_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.master_id = space_master_id and p.active
); $$;

create function public.is_space_master(space_master_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.id = space_master_id and p.role = 'master' and p.active
); $$;

alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.people enable row level security;
alter table public.invitations enable row level security;
alter table public.statements enable row level security;
alter table public.transactions enable row level security;
alter table public.workspaces enable row level security;

create policy "members read profiles" on public.profiles for select using (public.is_space_member(master_id));
create policy "members update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and master_id = (select master_id from public.profiles where id = auth.uid()));
create policy "members read cards" on public.cards for select using (public.is_space_member(master_id));
create policy "masters manage cards" on public.cards for all using (public.is_space_master(master_id)) with check (public.is_space_master(master_id));
create policy "members read people" on public.people for select using (public.is_space_member(master_id));
create policy "masters manage people" on public.people for all using (public.is_space_master(master_id)) with check (public.is_space_master(master_id));
create policy "masters manage invitations" on public.invitations for all using (public.is_space_master(master_id)) with check (public.is_space_master(master_id));
create policy "members read statements" on public.statements for select using (public.is_space_member(master_id));
create policy "masters manage statements" on public.statements for all using (public.is_space_master(master_id)) with check (public.is_space_master(master_id));
create policy "members read transactions" on public.transactions for select using (public.is_space_member(master_id));
create policy "masters manage transactions" on public.transactions for all using (public.is_space_master(master_id)) with check (public.is_space_master(master_id));
create policy "members read workspace" on public.workspaces for select using (public.is_space_member(master_id));
create policy "masters manage workspace" on public.workspaces for all using (public.is_space_master(master_id)) with check (public.is_space_master(master_id));

insert into storage.buckets (id, name, public) values ('statements', 'statements', false), ('avatars', 'avatars', false)
on conflict (id) do update set public = false;

-- Mutations, including a buyer note, go through Route Handlers with an explicit
-- field-level permission check. Postgres RLS cannot restrict a policy to one column.
-- The server uploads private files with service role and serves signed URLs only after authorization.
