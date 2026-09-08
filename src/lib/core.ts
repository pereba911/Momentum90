// ─────────────────────────────────────────────────────────────────────────────
// Goal Assistant 90 · utilidades PURAS de progreso y foco diario
// -----------------------------------------------------------------------------
// Este módulo NO depende de React ni de Supabase: es la fuente de verdad para
// calcular progreso de metas, prioridades del día, hábitos pendientes, tareas
// atrasadas y el resumen de avances. Se usa en la vista "Hoy" y en los tests.
//
// Reglas de datos (permanentes):
//  * Nunca muta el estado que recibe (todas las funciones son puras).
//  * Conserva IDs y relaciones; solo LEE arreglos/historiales existentes.
//  * El progreso monetario usa el acumulado real (currentAmount) y NUNCA inventa
//    montos: si no hay target, cae al progreso manual (progress).
// ─────────────────────────────────────────────────────────────────────────────

export type GoalKind = "money" | "habit" | "task";
export type GoalType = "annual" | "quarterly";
export type GoalPriority = "alta" | "media" | "baja";

export interface GoalLike {
  id: string;
  title: string;
  type: GoalType;
  kind: GoalKind;
  targetAmount?: number;
  currentAmount?: number;
  progress: number;
  status: string; // "active" | "in-progress" | "completed"
  priority?: GoalPriority;
  dueDate?: string; // YYYY-MM-DD
  completedAt?: string;
}

export interface TaskLike {
  id: string;
  text: string;
  completed: boolean;
  isKey: boolean;
  createdAt?: string;
  completedAt?: string;
  dueDate?: string; // YYYY-MM-DD
}

export interface HabitLike {
  id: string;
  name: string;
  emoji: string;
  category: string;
  maxPerDay: number;
  active: boolean;
}

export interface HabitLogLike {
  habitId: string;
  date: string; // YYYY-MM-DD
  count: number;
}

/** Porcentaje acotado a [0,100]. t <= 0 → 0 (evita división entre 0). */
export function pctOf(value: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

/**
 * Progreso de una meta (0-100).
 * - money con target → avance real (currentAmount / targetAmount).
 * - el resto → progreso manual (progress), que se actualiza por acción explícita
 *   del usuario (nunca se inventa ni se deriva de una contabilidad paralela).
 */
export function goalProgressOf(
  kind: GoalKind,
  targetAmount?: number,
  currentAmount?: number,
  manualProgress = 0,
): number {
  if (kind === "money" && targetAmount && targetAmount > 0) {
    return pctOf(currentAmount ?? 0, targetAmount);
  }
  return pctOf(manualProgress, 100);
}

/** Conteo registrado de un hábito en una fecha concreta (0 si no hay log). */
export function habitCountOn(logs: HabitLogLike[], habitId: string, date: string): number {
  return logs.find(l => l.habitId === habitId && l.date === date)?.count ?? 0;
}

/** Hábitos activos que aún NO alcanzaron su máximo hoy (pendientes). */
export function pendingHabitsToday(
  habits: HabitLike[],
  logs: HabitLogLike[],
  date: string,
): HabitLike[] {
  return habits.filter(h => h.active && habitCountOn(logs, h.id, date) < h.maxPerDay);
}

/**
 * Prioridades del día: hasta `limit` tareas pendientes, con las tareas clave
 * primero y luego por fecha límite (las que no tienen fecha van al final).
 * Devuelve una NUEVA lista (no muta la original) y respeta el orden estable.
 */
export function pickDailyPriorities(tasks: TaskLike[], limit = 3): TaskLike[] {
  const pending = tasks.filter(t => !t.completed);
  const sorted = [...pending].sort((a, b) => {
    if (a.isKey !== b.isKey) return a.isKey ? -1 : 1;
    const ad = a.dueDate || "9999-12-31";
    const bd = b.dueDate || "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  return sorted.slice(0, limit);
}

/** Próxima acción recomendada: primera prioridad del día (o null si no hay). */
export function nextRecommendedAction(tasks: TaskLike[]): TaskLike | null {
  return pickDailyPriorities(tasks, 1)[0] ?? null;
}

/** Tareas pendientes cuya fecha límite ya pasó (estrictamente menor que hoy). */
export function overdueTasks(tasks: TaskLike[], todayStr: string): TaskLike[] {
  return tasks.filter(t => !t.completed && !!t.dueDate && t.dueDate < todayStr);
}

/** Tareas clave completadas exactamente en una fecha (historial local). */
export function countKeyDoneOnDate(tasks: TaskLike[], date: string): number {
  return tasks.filter(t => t.isKey && t.completed && t.completedAt === date).length;
}

/**
 * Agrega varios grupos {x, y} en un solo porcentaje ponderado (0-100).
 * Se usa para el "progreso general" de la vista Hoy (metas + plan + hábitos).
 */
export function aggregateProgress(groups: { x: number; y: number }[]): number {
  const totalX = groups.reduce((a, g) => a + (Number(g.x) || 0), 0);
  const totalY = groups.reduce((a, g) => a + (Number(g.y) || 0), 0);
  return totalY > 0 ? Math.round((totalX / totalY) * 100) : 0;
}

/**
 * Backup profundo y RESTAURABLE de un estado (preservación de datos).
 * Devuelve un clon profundo que NO comparte referencias con el original, por lo
 * que "backup → restaurar" devuelve un estado idéntico (IDs y relaciones
 * intactas). Es idempotente: ejecutar el backup N veces no cambia el original.
 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(v => deepClone(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = deepClone((value as Record<string, unknown>)[k]);
  }
  return out as T;
}

/** ¿Dos valores JSON son estructuralmente idénticos? (compara claves ordenadas). */
export function isEqualJson<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fusión NO destructiva de entidades por usuario para la carga (reconcile).
 * Garantiza aislamiento entre usuarios: `rebase` recibe exclusivamente los
 * arreglos/objetos de UN usuario y nunca mezcla los de otro.
 */
export function mergeUserCollections<T>(
  base: Record<string, T[]>,
  override: Record<string, T[]>,
): Record<string, T[]> {
  const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
  const out: Record<string, T[]> = {};
  for (const k of keys) out[k] = [...(override[k] ?? base[k] ?? [])];
  return out;
}
