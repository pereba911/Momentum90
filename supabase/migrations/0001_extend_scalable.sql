-- ============================================================================
-- Momentum 90 · Migración 0001 · Extensión escalable (NO destructiva)
-- ----------------------------------------------------------------------------
-- Objetivos:
--   * Añadir tablas faltantes para la arquitectura multi-usuario.
--   * Endurecer RLS: cada usuario ve/edita solo sus datos; admin ve todo.
--   * Cerrar el hueco de seguridad de `profiles_self_access` (escalada de rol).
--   * Auto-crear el perfil (y rol) al registrarse un usuario.
--   * Base para auditoría, idempotencia y ledger financiero.
--
-- Reglas de esta migración:
--   * Solo CREATE TABLE IF NOT EXISTS / ALTER ... ADD COLUMN IF NOT EXISTS.
--   * NO borra tablas ni columnas.
--   * NO borra datos.
--   * Reemplaza únicamente políticas RLS inseguras (sin tocar datos).
-- ============================================================================

begin;

-- ── Helper de rol: ¿es admin el usuario autenticado? ─────────────────────────
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

-- ── Roles y asignación de roles ──────────────────────────────────────────────
create table if not exists public.roles (
  id text primary key,
  description text not null default '',
  created_at timestamptz not null default now()
);

insert into public.roles (id, description) values
  ('user',  'Usuario estándar'),
  ('admin', 'Administrador de la plataforma')
on conflict (id) do nothing;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' references public.roles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Auto-perfil al registrarse ───────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := case
    when lower(new.email) = lower(coalesce(current_setting('app.admin_email', true), 'octaface@gmail.com'))
      then 'admin'
    else 'user'
  end;

  insert into public.user_profiles (id, email, role, subscription_status)
  values (new.id, new.email, v_role, 'trial')
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, v_role)
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id, settings)
  values (new.id, '{}'::jsonb)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── user_profiles: columnas extra para suscripción/auditoría ────────────────
alter table public.user_profiles add column if not exists plan_id text;
alter table public.user_profiles add column if not exists billing_interval text;
alter table public.user_profiles add column if not exists last_payment_at timestamptz;
alter table public.user_profiles add column if not exists created_by uuid;
alter table public.user_profiles add column if not exists updated_by uuid;
alter table public.user_profiles add column if not exists deleted_at timestamptz;

-- ── Activos monetarios ───────────────────────────────────────────────────────
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash', 'bank', 'investment', 'property', 'business', 'vehicle', 'receivable', 'other')),
  value bigint not null default 0,        -- pesos enteros (sin centavos)
  updated_at date not null default current_date,
  notes text,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ── Ledger financiero (una sola vez por movimiento) ──────────────────────────
create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  name text not null,
  type text not null default 'cash',
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer', 'adjustment')),
  amount bigint not null check (amount >= 0),
  date date not null default current_date,
  description text not null default '',
  category text,
  source_account uuid references public.financial_accounts(id),
  destination_account uuid references public.financial_accounts(id),
  goal_id uuid,
  business_id uuid,
  status text not null default 'posted' check (status in ('pending', 'posted', 'reversed')),
  idempotency_key text unique,           -- evita doble registro
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  goal_id uuid,
  business_id uuid,
  amount bigint not null check (amount >= 0),
  created_at timestamptz not null default now()
);

-- ── Abonos a metas (historial auditable e idempotente) ───────────────────────
create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount bigint not null check (amount > 0),
  date date not null default current_date,
  note text,
  idempotency_key text unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ── Logros / avances trimestrales y anuales ──────────────────────────────────
create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  kind text not null check (kind in ('goal', 'task', 'habit', 'manual')),
  title text not null,
  date date not null default current_date,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.quarterly_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  year integer not null,
  quarter integer not null check (quarter between 1 and 4),
  goals_completed integer not null default 0,
  income_collected bigint not null default 0,
  mini_victories integer not null default 0,
  avg_ceo_score numeric(5,2),
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year, quarter)
);

create table if not exists public.annual_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  year integer not null,
  goals_completed integer not null default 0,
  income_collected bigint not null default 0,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year)
);

-- ── Integraciones futuras (Stripe, etc.) ─────────────────────────────────────
create table if not exists public.integrations (
  id text not null,                      -- 'stripe', 'whatsapp', 'openai', ...
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  enabled boolean not null default false,
  config jsonb not null default '{}',    -- SOLO datos públicos; secretos en Edge
  status text not null default 'disconnected',
  last_error text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

-- ── Suscripciones (espejo de Stripe) ─────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  provider text not null default 'stripe',
  plan_id text,
  billing_interval text,
  status text not null default 'trial',
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_end timestamptz,
  last_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Audit log ────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  entity text,
  entity_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- ── Negocios/tratos (deals) con probabilidad y avance ────────────────────────
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  title text not null,
  value bigint not null default 0,
  probability integer not null default 0 check (probability between 0 and 100),
  stage_id uuid references public.pipeline_stages(id),
  expected_close_date date,
  owner text,
  notes text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Índices
-- ============================================================================
create index if not exists idx_assets_user on public.assets(user_id, deleted_at);
create index if not exists idx_tx_user_date on public.financial_transactions(user_id, date);
create index if not exists idx_tx_idempotency on public.financial_transactions(idempotency_key);
create index if not exists idx_goal_contrib_goal on public.goal_contributions(goal_id, date);
create index if not exists idx_goal_contrib_idem on public.goal_contributions(idempotency_key);
create index if not exists idx_integrations_user on public.integrations(user_id, enabled);
create index if not exists idx_subscriptions_user on public.subscriptions(user_id);
create index if not exists idx_audit_user on public.audit_log(user_id, created_at);
create index if not exists idx_deals_user on public.deals(user_id, stage_id);
create index if not exists idx_quarterly_user on public.quarterly_progress(user_id, year, quarter);
create index if not exists idx_annual_user on public.annual_progress(user_id, year);

-- ============================================================================
-- RLS
-- ============================================================================

-- Tablas existentes nuevas: activar RLS
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.assets enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.financial_allocations enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.achievements enable row level security;
alter table public.quarterly_progress enable row level security;
alter table public.annual_progress enable row level security;
alter table public.integrations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_log enable row level security;
alter table public.deals enable row level security;

-- ── Políticas genéricas: usuario solo sobre sus datos; admin sobre todos ────
drop policy if exists "roles_read" on public.roles;

create policy "roles_read"
on public.roles
for select
to authenticated
using (true);

drop policy if exists "user_roles_self" on public.user_roles;

create policy "user_roles_self"
on public.user_roles
for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "assets_self_access" on public.assets;
drop policy if exists "assets_admin_all" on public.assets;

create policy "assets_self_access"
on public.assets
for all
to authenticated
using (auth.uid() = user_id and deleted_at is null)
with check (auth.uid() = user_id and deleted_at is null);

create policy "assets_admin_all"
on public.assets
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "financial_accounts_self_access" on public.financial_accounts;
drop policy if exists "financial_accounts_admin_all" on public.financial_accounts;

create policy "financial_accounts_self_access"
on public.financial_accounts
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "financial_accounts_admin_all"
on public.financial_accounts
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "financial_transactions_self_access" on public.financial_transactions;
drop policy if exists "financial_transactions_admin_all" on public.financial_transactions;

create policy "financial_transactions_self_access"
on public.financial_transactions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "financial_transactions_admin_all"
on public.financial_transactions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "financial_allocations_self_access" on public.financial_allocations;
drop policy if exists "financial_allocations_admin_all" on public.financial_allocations;

create policy "financial_allocations_self_access"
on public.financial_allocations
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "financial_allocations_admin_all"
on public.financial_allocations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "goal_contributions_self_access" on public.goal_contributions;
drop policy if exists "goal_contributions_admin_all" on public.goal_contributions;

create policy "goal_contributions_self_access"
on public.goal_contributions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "goal_contributions_admin_all"
on public.goal_contributions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "achievements_self_access" on public.achievements;
drop policy if exists "achievements_admin_all" on public.achievements;

create policy "achievements_self_access"
on public.achievements
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "achievements_admin_all"
on public.achievements
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "quarterly_progress_self_access" on public.quarterly_progress;
drop policy if exists "quarterly_progress_admin_all" on public.quarterly_progress;

create policy "quarterly_progress_self_access"
on public.quarterly_progress
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "quarterly_progress_admin_all"
on public.quarterly_progress
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "annual_progress_self_access" on public.annual_progress;
drop policy if exists "annual_progress_admin_all" on public.annual_progress;

create policy "annual_progress_self_access"
on public.annual_progress
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "annual_progress_admin_all"
on public.annual_progress
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "integrations_self_access" on public.integrations;
drop policy if exists "integrations_admin_all" on public.integrations;

create policy "integrations_self_access"
on public.integrations
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "integrations_admin_all"
on public.integrations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "subscriptions_self_access" on public.subscriptions;
drop policy if exists "subscriptions_admin_all" on public.subscriptions;

create policy "subscriptions_self_access"
on public.subscriptions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "subscriptions_admin_all"
on public.subscriptions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "audit_log_admin_insert" on public.audit_log;
drop policy if exists "audit_log_admin_read" on public.audit_log;

create policy "audit_log_admin_insert"
on public.audit_log
for insert
to authenticated
with check (true);

create policy "audit_log_admin_read"
on public.audit_log
for select
to authenticated
using (public.is_admin() or auth.uid() = user_id);

drop policy if exists "deals_self_access" on public.deals;
drop policy if exists "deals_admin_all" on public.deals;

create policy "deals_self_access"
on public.deals
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "deals_admin_all"
on public.deals
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ============================================================================
-- ENDURECER POLÍTICAS DE user_profiles (evitar escalada de rol)
-- ----------------------------------------------------------------------------
-- La política anterior `profiles_self_access` (FOR ALL con auth.uid() = id)
-- permitía a un usuario editar su propio `role`. Se reemplaza por:
--   * SELECT  : el propio usuario o admin.
--   * INSERT  : solo el propio usuario (con el id = auth.uid()).
--   * UPDATE/DELETE : solo admin (vía Edge/Service Role para cambios de rol).
-- ============================================================================
drop policy if exists "profiles_self_access" on public.user_profiles;
drop policy if exists "profiles_self_select" on public.user_profiles;
drop policy if exists "profiles_self_insert" on public.user_profiles;
drop policy if exists "profiles_admin_all" on public.user_profiles;

create policy "profiles_self_select"
on public.user_profiles
for select
to authenticated
using (auth.uid() = id or public.is_admin());

create policy "profiles_self_insert"
on public.user_profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_admin_all"
on public.user_profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- user_settings: mismo endurecimiento (el usuario puede actualizar sus
-- propios settings, pero no ver/editar los de otros).
drop policy if exists "settings_self_access" on public.user_settings;
drop policy if exists "settings_self_select" on public.user_settings;
drop policy if exists "settings_self_write" on public.user_settings;
drop policy if exists "settings_admin_all" on public.user_settings;

create policy "settings_self_select"
on public.user_settings
for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

create policy "settings_self_write"
on public.user_settings
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "settings_admin_all"
on public.user_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- app_data / user_entities: mantener acceso propio; añadir lectura admin.
drop policy if exists "app_data_admin_read" on public.app_data;

create policy "app_data_admin_read"
on public.app_data
for select
to authenticated
using (public.is_admin());

drop policy if exists "user_entities_admin_read" on public.user_entities;

create policy "user_entities_admin_read"
on public.user_entities
for select
to authenticated
using (public.is_admin());

commit;
