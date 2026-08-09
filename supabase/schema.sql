-- Momentum 90 – esquema relacional propuesto para Supabase
-- Objetivo: persistencia real de ingresos, gastos, metas, tareas y pipelines por usuario.

create extension if not exists "pgcrypto";

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user',
  currency text not null default 'MXN',
  trial_start timestamptz,
  trial_end timestamptz,
  trial_days integer not null default 14,
  subscription_status text not null default 'trial' check (subscription_status in ('active', 'trial', 'expired')),
  subscription_expires_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.user_profiles(id) on delete cascade,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_data (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.user_entities (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  entity text not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, entity)
);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  date date not null,
  type text not null,
  description text not null,
  amount numeric(14,2) not null,
  status text not null check (status in ('prospect', 'projected', 'collected')),
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  date date not null,
  category text not null,
  business_category text,
  description text not null,
  amount numeric(14,2) not null,
  recurring boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  category text not null,
  business_category text,
  description text not null,
  amount numeric(14,2) not null,
  date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  name text not null,
  balance numeric(14,2) not null,
  min_payment numeric(14,2) not null default 0,
  target_payment numeric(14,2) not null default 0,
  original_balance numeric(14,2) not null,
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  title text not null,
  type text not null check (type in ('annual', 'quarterly')),
  kind text not null check (kind in ('money', 'habit', 'task')),
  category text check (category in (
    'salud_y_cuerpo',
    'carrera_y_trabajo',
    'dinero',
    'relaciones',
    'deseos_personales'
  )),
  target_amount numeric(14,2),
  current_amount numeric(14,2) not null default 0,
  progress numeric(5,2) not null default 0,
  status text not null check (status in ('active', 'in-progress', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  text text not null,
  is_key boolean not null default false,
  recurring_type text not null default 'none' check (recurring_type in ('none', 'daily', 'weekly', 'monthly', 'annual')),
  recurring_days jsonb not null default '[]'::jsonb,
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  completed_at timestamptz not null default now()
);

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('business', 'contact')),
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  order_index integer not null,
  color text,
  created_at timestamptz not null default now(),
  unique (pipeline_id, order_index)
);

create table if not exists public.pipeline_items (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  item_type text not null check (item_type in ('business', 'contact')),
  title text not null,
  emoji text,
  category text,
  description text,
  value numeric(14,2),
  owner text,
  notes text,
  progress_pct numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_contacts (
  business_id uuid not null references public.pipeline_items(id) on delete cascade,
  contact_id uuid not null references public.pipeline_items(id) on delete cascade,
  primary key (business_id, contact_id)
);

create index if not exists idx_incomes_user_date on public.incomes(user_id, date);
create index if not exists idx_expenses_user_date on public.expenses(user_id, date);
create index if not exists idx_goals_user_kind on public.goals(user_id, kind, type);
create index if not exists idx_tasks_user_due on public.tasks(user_id, due_date, is_key, completed);
create index if not exists idx_pipeline_items_pipeline_stage on public.pipeline_items(pipeline_id, stage_id);

-- Helper: ¿es admin el usuario autenticado? (debe definirse tras crear tablas)
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

alter table public.user_profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.app_data enable row level security;
alter table public.user_entities enable row level security;
alter table public.incomes enable row level security;
alter table public.expenses enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.debts enable row level security;
alter table public.goals enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.pipeline_items enable row level security;
alter table public.business_contacts enable row level security;

-- NOTA: el usuario NO puede editar su propio role (evita escalada a admin).
-- Los cambios de rol se hacen vía Edge Function/Service Role (solo admin).
drop policy if exists "profiles_self_access" on public.user_profiles;
drop policy if exists "profiles_self_select" on public.user_profiles;
drop policy if exists "profiles_self_insert" on public.user_profiles;
drop policy if exists "profiles_admin_all" on public.user_profiles;

create policy "profiles_self_select"
on public.user_profiles
for select
using (auth.uid() = id or public.is_admin());

create policy "profiles_self_insert"
on public.user_profiles
for insert
with check (auth.uid() = id);

create policy "profiles_admin_all"
on public.user_profiles
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "settings_self_access" on public.user_settings;
drop policy if exists "settings_self_select" on public.user_settings;
drop policy if exists "settings_self_write" on public.user_settings;
drop policy if exists "settings_admin_all" on public.user_settings;

create policy "settings_self_select"
on public.user_settings
for select
using (auth.uid() = user_id or public.is_admin());

create policy "settings_self_write"
on public.user_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "settings_admin_all"
on public.user_settings
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "app_data_self_access" on public.app_data;
drop policy if exists "app_data_admin_read" on public.app_data;

create policy "app_data_self_access"
on public.app_data
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "app_data_admin_read"
on public.app_data
for select
using (public.is_admin());

drop policy if exists "user_entities_self_access" on public.user_entities;
drop policy if exists "user_entities_admin_read" on public.user_entities;

create policy "user_entities_self_access"
on public.user_entities
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_entities_admin_read"
on public.user_entities
for select
using (public.is_admin());

drop policy if exists "incomes_self_access" on public.incomes;

create policy "incomes_self_access"
on public.incomes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "expenses_self_access" on public.expenses;

create policy "expenses_self_access"
on public.expenses
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "recurring_expenses_self_access" on public.recurring_expenses;

create policy "recurring_expenses_self_access"
on public.recurring_expenses
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "debts_self_access" on public.debts;

create policy "debts_self_access"
on public.debts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "goals_self_access" on public.goals;

create policy "goals_self_access"
on public.goals
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "tasks_self_access" on public.tasks;

create policy "tasks_self_access"
on public.tasks
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "task_completions_self_access" on public.task_completions;

create policy "task_completions_self_access"
on public.task_completions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "pipelines_self_access" on public.pipelines;

create policy "pipelines_self_access"
on public.pipelines
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "pipeline_stages_self_access" on public.pipeline_stages;

create policy "pipeline_stages_self_access"
on public.pipeline_stages
for all
using (exists (
  select 1 from public.pipelines p
  where p.id = pipeline_stages.pipeline_id
    and p.user_id = auth.uid()
))
with check (exists (
  select 1 from public.pipelines p
  where p.id = pipeline_stages.pipeline_id
    and p.user_id = auth.uid()
));

drop policy if exists "pipeline_items_self_access" on public.pipeline_items;

create policy "pipeline_items_self_access"
on public.pipeline_items
for all
using (exists (
  select 1 from public.pipelines p
  where p.id = pipeline_items.pipeline_id
    and p.user_id = auth.uid()
))
with check (exists (
  select 1 from public.pipelines p
  where p.id = pipeline_items.pipeline_id
    and p.user_id = auth.uid()
));

drop policy if exists "business_contacts_self_access" on public.business_contacts;

create policy "business_contacts_self_access"
on public.business_contacts
for all
using (
  exists (
    select 1 from public.pipeline_items b
    join public.pipelines bp on bp.id = b.pipeline_id
    where b.id = business_contacts.business_id
      and bp.user_id = auth.uid()
  )
  and exists (
    select 1 from public.pipeline_items c
    join public.pipelines cp on cp.id = c.pipeline_id
    where c.id = business_contacts.contact_id
      and cp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.pipeline_items b
    join public.pipelines bp on bp.id = b.pipeline_id
    where b.id = business_contacts.business_id
      and bp.user_id = auth.uid()
  )
  and exists (
    select 1 from public.pipeline_items c
    join public.pipelines cp on cp.id = c.pipeline_id
    where c.id = business_contacts.contact_id
      and cp.user_id = auth.uid()
  )
);
