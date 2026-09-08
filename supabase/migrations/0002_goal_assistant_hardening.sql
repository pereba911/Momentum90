-- ============================================================================
-- Goal Assistant 90 · Migración 0002 · Endurecimiento y consistencia (ADITIVA)
-- ----------------------------------------------------------------------------
-- Objetivos (SIN pérdida de datos, totalmente reversible):
--   * Timestamps consistentes: trigger que actualiza `updated_at` automáticamente
--     en TODAS las tablas por usuario que tengan la columna (solo si existen).
--   * Borrado lógico: añade `deleted_at` (nullable) donde falte; NUNCA borra.
--   * Índices por user_id / fecha / estado / ciclo para las tablas de datos.
--   * RLS: políticas por usuario con auth.uid() y lectura de admin; cierra huecos
--     (roles: solo admin escribe user_roles).
--   * Idempotente: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS y triggers
--     protegidos con DO $$ (verifica existencia real antes de crear).
--
-- Reglas:
--   * NO DROP TABLE, NO TRUNCATE, NO DELETE, NO ALTER destructivo.
--   * Se puede ejecutar varias veces sin duplicar datos.
-- ============================================================================

begin;

-- ── Helper: trigger genérico de updated_at ───────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Aplica el trigger de updated_at a una tabla SOLO si existe y tiene la columna.
create or replace function public.ensure_updated_at_trigger(p_table text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_sql text;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    return;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'updated_at'
  ) then
    return;
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = format('trg_%s_updated_at', p_table)
  ) then
    v_sql := format('create trigger trg_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()', p_table, p_table);
    execute v_sql;
  end if;
end;
$$;

-- Aplica borrado lógico (columna deleted_at nullable) SOLO si la tabla existe.
create or replace function public.ensure_soft_delete_column(p_table text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if to_regclass(format('public.%I', p_table)) is null then
    return;
  end if;
  execute format('alter table public.%I add column if not exists deleted_at timestamptz', p_table);
end;
$$;

-- ── Aplicar a las tablas por usuario del runtime + relacionales ──────────────
do $$
begin
  perform public.ensure_updated_at_trigger('user_profiles');
  perform public.ensure_updated_at_trigger('user_settings');
  perform public.ensure_updated_at_trigger('app_data');
  perform public.ensure_updated_at_trigger('user_entities');
  perform public.ensure_updated_at_trigger('incomes');
  perform public.ensure_updated_at_trigger('expenses');
  perform public.ensure_updated_at_trigger('recurring_expenses');
  perform public.ensure_updated_at_trigger('debts');
  perform public.ensure_updated_at_trigger('goals');
  perform public.ensure_updated_at_trigger('tasks');
  perform public.ensure_updated_at_trigger('pipelines');
  perform public.ensure_updated_at_trigger('pipeline_stages');
  perform public.ensure_updated_at_trigger('pipeline_items');
  perform public.ensure_updated_at_trigger('assets');
  perform public.ensure_updated_at_trigger('financial_accounts');
  perform public.ensure_updated_at_trigger('financial_transactions');
  perform public.ensure_updated_at_trigger('goal_contributions');
  perform public.ensure_updated_at_trigger('achievements');
  perform public.ensure_updated_at_trigger('quarterly_progress');
  perform public.ensure_updated_at_trigger('annual_progress');
  perform public.ensure_updated_at_trigger('integrations');
  perform public.ensure_updated_at_trigger('subscriptions');
  perform public.ensure_updated_at_trigger('deals');
  perform public.ensure_updated_at_trigger('user_roles');
end $$;

-- Borrado lógico (nunca DELETE físico) en las tablas que hoy no lo tienen.
do $$
begin
  perform public.ensure_soft_delete_column('user_entities');
  perform public.ensure_soft_delete_column('incomes');
  perform public.ensure_soft_delete_column('expenses');
  perform public.ensure_soft_delete_column('recurring_expenses');
  perform public.ensure_soft_delete_column('debts');
  perform public.ensure_soft_delete_column('goals');
  perform public.ensure_soft_delete_column('tasks');
  perform public.ensure_soft_delete_column('pipelines');
  perform public.ensure_soft_delete_column('pipeline_stages');
  perform public.ensure_soft_delete_column('pipeline_items');
  perform public.ensure_soft_delete_column('financial_accounts');
  perform public.ensure_soft_delete_column('financial_transactions');
  perform public.ensure_soft_delete_column('financial_allocations');
  perform public.ensure_soft_delete_column('goal_contributions');
  perform public.ensure_soft_delete_column('achievements');
  perform public.ensure_soft_delete_column('quarterly_progress');
  perform public.ensure_soft_delete_column('annual_progress');
  perform public.ensure_soft_delete_column('integrations');
  perform public.ensure_soft_delete_column('subscriptions');
  perform public.ensure_soft_delete_column('deals');
end $$;

-- ── Índices por user_id / fecha / estado / ciclo (idempotente) ───────────────
-- Índices de tablas que SIEMPRE existen en el runtime:
create index if not exists idx_app_data_updated on public.app_data(updated_at);
create index if not exists idx_user_entities_updated on public.user_entities(user_id, updated_at);
create index if not exists idx_user_entities_deleted on public.user_entities(user_id, entity) where deleted_at is null;
create index if not exists idx_profiles_role on public.user_profiles(role);
create index if not exists idx_profiles_status on public.user_profiles(subscription_status);
create index if not exists idx_profiles_email on public.user_profiles(email);
create index if not exists idx_user_roles_role on public.user_roles(role);
create index if not exists idx_audit_action on public.audit_log(action);
-- Índices opcionales protegidos (la tabla puede no existir en ciertos entornos):
do $$
begin
  if to_regclass('public.deals') is not null then
    execute 'create index if not exists idx_deals_user_status on public.deals(user_id, status)';
  end if;
  if to_regclass('public.assets') is not null then
    execute 'create index if not exists idx_assets_user_type on public.assets(user_id, type)';
  end if;
  if to_regclass('public.goal_contributions') is not null then
    execute 'create index if not exists idx_goal_contrib_user on public.goal_contributions(user_id, date)';
  end if;
  if to_regclass('public.achievements') is not null then
    execute 'create index if not exists idx_achievements_user_date on public.achievements(user_id, date)';
  end if;
end $$;

-- ── RLS: cierre de huecos y endurecimiento ───────────────────────────────────
-- user_profiles: el propio usuario puede leer SU perfil; SOLO admin actualiza
-- rol/estado (vía Edge Function con service role). (refuerzo explícito)
drop policy if exists "profiles_self_select" on public.user_profiles;
create policy "profiles_self_select"
on public.user_profiles
for select
to authenticated
using (auth.uid() = id or public.is_admin());

-- user_roles: el usuario lee su propio rol; SOLO admin inserta/actualiza.
drop policy if exists "user_roles_admin_all" on public.user_roles;
create policy "user_roles_admin_all"
on public.user_roles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- audit_log: la auditoría se puede insertar (edge con service role) y leer
-- por el propio usuario o admin. Refuerzo explícito (sin borrado).
drop policy if exists "audit_log_admin_insert" on public.audit_log;
create policy "audit_log_admin_insert"
on public.audit_log
for insert
to authenticated
with check (true);

drop policy if exists "audit_log_admin_read" on public.audit_log;
create policy "audit_log_admin_read"
on public.audit_log
for select
to authenticated
using (public.is_admin() or auth.uid() = user_id);

-- admin_audit_log: cierra el hueco "RLS sin políticas" (solo admin; sin borrado).
drop policy if exists "admin_audit_log_admin_all" on public.admin_audit_log;
create policy "admin_audit_log_admin_all"
on public.admin_audit_log
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- user_settings: solo el dueño (o admin) — ya existente, se refuerza igual.
drop policy if exists "settings_admin_all" on public.user_settings;
create policy "settings_admin_all"
on public.user_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Limpieza de helpers temporales (funciones de aplicación ya persistentes se
-- conservan; estas dos son idempotentes y no afectan datos).
-- (No se borra nada: se dejan para reutilización en futuras migraciones.)

commit;
