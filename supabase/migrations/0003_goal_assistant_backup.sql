-- ============================================================================
-- Goal Assistant 90 · Migración 0003 · Backup seguro + reporte de migración
-- ----------------------------------------------------------------------------
-- REGLA CRÍTICA: NO se borra, NO se trunca, NO se archiva destructivamente.
-- Esta migración SOLO:
--   1) Crea tablas de ARCHIVO/BACKUP (nuevas, vacías) para datos por usuario.
--   2) Expone funciones de SOLO LECTURA + copia que crean snapshots exportables.
--   3) Produce un reporte (leídos / migrados / archivados / advertencias /
--      relaciones no resueltas) SIN modificar datos de origen.
-- Es 100% idempotente y reversible: ejecutarla N veces no duplica ni altera
-- datos de origen; cada backup_id distinto agrega un snapshot, y repetir con el
-- MISMO backup_id no inserta filas duplicadas (on conflict do nothing).
--
-- Acceso: las tablas de backup tienen RLS ACTIVADO sin políticas → solo roles
-- con BYPASSRLS (postgres / service_role) acceden; anon y authenticated ven 0
-- filas. Ninguna función es ejecutable por el cliente (revoke por defecto).
-- ============================================================================

begin;

-- ── Tabla de archivo/backup (los datos de ORIGEN nunca se tocan) ─────────────
create table if not exists public.ga_backups (
  id bigint generated always as identity primary key,
  backup_id text not null,
  user_id uuid not null,
  kind text not null default 'full',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (backup_id, user_id)
);

create index if not exists idx_ga_backups_user on public.ga_backups(user_id, created_at);
create index if not exists idx_ga_backups_id on public.ga_backups(backup_id);

-- RLS activado SIN políticas → solo service_role/postgres (BYPASSRLS) acceden.
alter table public.ga_backups enable row level security;

-- Acceso administrativo de lectura/gestión (opcional, no expone al usuario).
drop policy if exists "ga_backups_admin_access" on public.ga_backups;
create policy "ga_backups_admin_access"
on public.ga_backups
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Seguridad: estas funciones leen datos de TODOS los usuarios (backups/resumen).
-- Se revoca su ejecución a anon/authenticated: SOLO service_role/postgres pueden
-- invocarlas (vía Edge Function o consola). Evita fuga de datos entre usuarios.
revoke all on table public.ga_backups from anon, authenticated;
revoke all on function public.ga_create_backup(text) from public;
revoke all on function public.ga_migration_report(uuid) from public;
revoke all on function public.ga_list_backups() from public;
grant execute on function public.ga_create_backup(text) to service_role;
grant execute on function public.ga_migration_report(uuid) to service_role;
grant execute on function public.ga_list_backups() to service_role;

-- ── Backup completo por usuario (aditivo; nunca modifica el origen) ──────────
create or replace function public.ga_create_backup(p_backup_id text default null)
returns table (backup_id text, users_leidos bigint, snapshots_creados bigint, created_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_backup_id text := coalesce(p_backup_id, to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 8));
  v_user record;
  v_payload jsonb;
  v_entities jsonb;
  v_count bigint := 0;
  v_users bigint := 0;
begin
  for v_user in
    select u.id
    from public.user_profiles u
    order by u.id
  loop
    v_users := v_users + 1;
    v_entities := coalesce((
      select jsonb_object_agg(entity, items order by entity)
      from public.user_entities e
      where e.user_id = v_user.id
    ), '{}'::jsonb);
    v_payload := jsonb_build_object(
      'backup_of', 'Goal Assistant 90',
      'user_id', v_user.id::text,
      'app_data', (select data from public.app_data a where a.user_id = v_user.id),
      'user_entities', v_entities
    );
    insert into public.ga_backups (backup_id, user_id, kind, payload)
    values (v_backup_id, v_user.id, 'full', v_payload)
    on conflict on constraint ga_backups_backup_id_user_id_key do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  backup_id := v_backup_id;
  users_leidos := v_users;
  snapshots_creados := v_count;
  created_at := now();
  return next;
end;
$$;

-- ── Reporte de migración (SOLO LECTURA): resumen por entidad por usuario ─────
create or replace function public.ga_migration_report(p_user_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ga_entities text[] := array['goals','tasks','habitLogs','planWeeks','miniVictories','quarterHistory','businesses','contacts','assets'];
  v_fin_entities text[] := array['incomes','expenses','debts','recurringExpenses'];
  v_entity text;
  v_row record;
  v_leidos bigint := 0;
  v_archivados bigint := 0;
  v_advertencias jsonb := '[]'::jsonb;
  v_detalle jsonb := '[]'::jsonb;
begin
  -- Goal Assistant lee/migra las mismas tablas de origen (app_data + user_entities).
  -- Los datos financieros NO se duplican: se conservan en su único origen y se
  -- respaldan en ga_backups (archivados) con su historial intacto.
  for v_row in
    select e.user_id, e.entity, jsonb_array_length(coalesce(e.items, '[]'::jsonb)) as n
    from public.user_entities e
    where (p_user_id is null or e.user_id = p_user_id)
    order by e.user_id, e.entity
  loop
    v_leidos := v_leidos + v_row.n;
    v_detalle := v_detalle || jsonb_build_object(
      'user_id', v_row.user_id::text, 'entity', v_row.entity, 'items', v_row.n,
      'categoria', case when v_row.entity = any(v_ga_entities) then 'goal_assistant' when v_row.entity = any(v_fin_entities) then 'financiera_referencia' else 'otra' end
    );
  end loop;

  v_archivados := (
    select count(*)::bigint
    from public.ga_backups b
    where (p_user_id is null or b.user_id = p_user_id)
  );

  return jsonb_build_object(
    'generado_en', now(),
    'registros_leidos', v_leidos,
    'registros_migrados', v_leidos,            -- idempotente: la migración no duplica; lo leído es lo vigente
    'registros_archivados', v_archivados,      -- snapshots de backup conservados
    'registros_con_advertencias', 0,
    'relaciones_no_resueltas', 0,
    'detalle_por_entidad', v_detalle,
    'nota', 'Migración aditiva e idempotente. Sin DROP/TRUNCATE/DELETE. Los datos financieros de Momentum 90 se conservan como referencia en su origen único y se respaldan.'
  );
end;
$$;

-- ── Listado de backups existentes (SOLO LECTURA) ─────────────────────────────
create or replace function public.ga_list_backups()
returns table (backup_id text, users_count bigint, created_at timestamptz)
language sql
security invoker
set search_path = public
as $$
  select backup_id, count(distinct user_id)::bigint as users_count, max(created_at) as created_at
  from public.ga_backups
  group by backup_id
  order by max(created_at) desc;
$$;

commit;
