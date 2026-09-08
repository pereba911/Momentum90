// ─────────────────────────────────────────────────────────────────────────────
// Goal Assistant 90 · Tests de lógica pura (progreso de metas, hábitos,
// prioridades diarias, tareas atrasadas y preservación de datos).
// Importan src/lib/core (misma lógica que usa la vista "Hoy").
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  pctOf,
  goalProgressOf,
  habitCountOn,
  pendingHabitsToday,
  pickDailyPriorities,
  nextRecommendedAction,
  overdueTasks,
  countKeyDoneOnDate,
  aggregateProgress,
  deepClone,
  isEqualJson,
  mergeUserCollections,
  type GoalLike,
  type TaskLike,
  type HabitLike,
  type HabitLogLike,
} from "../src/lib/core";

const todayStr = "2026-09-05";

function goal(over: Partial<GoalLike> = {}): GoalLike {
  return { id: "g1", title: "Meta", type: "annual", kind: "task", progress: 0, status: "active", ...over };
}
function task(over: Partial<TaskLike> = {}): TaskLike {
  return { id: "t1", text: "Tarea", completed: false, isKey: false, createdAt: "2026-09-01", ...over };
}
function habit(over: Partial<HabitLike> = {}): HabitLike {
  return { id: "h1", name: "Gym", emoji: "🏋️", category: "salud", maxPerDay: 1, active: true, ...over };
}

describe("pctOf (cálculo de porcentajes sin división entre 0)", () => {
  it("calcula porcentajes y acota a 100", () => {
    expect(pctOf(50, 200)).toBe(25);
    expect(pctOf(250, 200)).toBe(100);
    expect(pctOf(0, 100)).toBe(0);
  });
  it("total 0 o negativo → 0 (sin NaN)", () => {
    expect(pctOf(10, 0)).toBe(0);
    expect(pctOf(10, -5)).toBe(0);
  });
});

describe("goalProgressOf (cálculo de progreso de metas)", () => {
  it("meta monetaria con target usa avance real (currentAmount/targetAmount)", () => {
    expect(goalProgressOf("money", 200, 50, 90)).toBe(25); // ignora el manual
    expect(goalProgressOf("money", 200, 200, 0)).toBe(100);
  });
  it("meta no monetaria (hábito/tarea) usa progreso manual explícito", () => {
    expect(goalProgressOf("task", undefined, undefined, 45)).toBe(45);
    expect(goalProgressOf("habit", 0, 10, 33)).toBe(33); // target 0 → manual
  });
  it("meta money sin target cae al progreso manual (nunca inventa contabilidad)", () => {
    expect(goalProgressOf("money", undefined, 500, 70)).toBe(70);
  });
});

describe("countKeyDoneOnDate / habitCountOn (historial diario preservado)", () => {
  it("cuenta tareas clave completadas exactamente en una fecha", () => {
    const tasks = [
      task({ id: "a", isKey: true, completed: true, completedAt: "2026-09-05" }),
      task({ id: "b", isKey: true, completed: true, completedAt: "2026-09-04" }),
      task({ id: "c", isKey: true, completed: false }),
    ];
    expect(countKeyDoneOnDate(tasks, "2026-09-05")).toBe(1);
  });
  it("habitCountOn devuelve 0 sin log y el conteo si existe", () => {
    const logs: HabitLogLike[] = [{ habitId: "h1", date: todayStr, count: 2 }];
    expect(habitCountOn(logs, "h1", todayStr)).toBe(2);
    expect(habitCountOn(logs, "h1", "2026-09-01")).toBe(0);
  });
});

describe("pickDailyPriorities (tres prioridades del día)", () => {
  it("prioriza tareas clave y limita a 3", () => {
    const tasks = [
      task({ id: "normal1", isKey: false, dueDate: "2026-09-04" }),
      task({ id: "key1", isKey: true, dueDate: "2026-09-10" }),
      task({ id: "key2", isKey: true, dueDate: "2026-09-11" }),
      task({ id: "key3", isKey: true, dueDate: "2026-09-12" }),
      task({ id: "normal2", isKey: false, dueDate: "2026-09-03" }),
    ];
    const top = pickDailyPriorities(tasks, 3);
    expect(top.map(t => t.id)).toEqual(["key1", "key2", "key3"]);
  });
  it("completadas nunca aparecen y devuelve lista nueva (no muta)", () => {
    const tasks = [task({ id: "k", isKey: true, completed: false }), task({ id: "done", isKey: true, completed: true })];
    const before = JSON.stringify(tasks);
    const top = pickDailyPriorities(tasks, 3);
    expect(top).toHaveLength(1);
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it("sin tareas → []", () => {
    expect(pickDailyPriorities([], 3)).toEqual([]);
    expect(nextRecommendedAction([])).toBeNull();
  });
  it("nextRecommendedAction devuelve la primera prioridad", () => {
    const tasks = [task({ id: "x", isKey: false }), task({ id: "y", isKey: true })];
    expect(nextRecommendedAction(tasks)?.id).toBe("y");
  });
});

describe("pendingHabitsToday (hábitos pendientes del día)", () => {
  it("excluye hábitos ya completados hoy y los inactivos", () => {
    const habits: HabitLike[] = [
      habit({ id: "done", maxPerDay: 1 }),
      habit({ id: "pending", maxPerDay: 2 }),
      habit({ id: "off", maxPerDay: 1, active: false }),
    ];
    const logs: HabitLogLike[] = [{ habitId: "done", date: todayStr, count: 1 }, { habitId: "pending", date: todayStr, count: 1 }];
    const pend = pendingHabitsToday(habits, logs, todayStr);
    expect(pend.map(h => h.id)).toEqual(["pending"]); // 1/2, falta 1
  });
});

describe("overdueTasks (alertas de tareas atrasadas)", () => {
  it("solo tareas pendientes con fecha < hoy", () => {
    const tasks = [
      task({ id: "late", dueDate: "2026-09-04" }),
      task({ id: "today", dueDate: todayStr }),
      task({ id: "future", dueDate: "2026-09-06" }),
      task({ id: "noDue" }),
      task({ id: "doneLate", dueDate: "2026-09-01", completed: true }),
    ];
    const late = overdueTasks(tasks, todayStr);
    expect(late.map(t => t.id)).toEqual(["late"]);
  });
});

describe("aggregateProgress (progreso general ponderado)", () => {
  it("agrega grupos x/y en un porcentaje", () => {
    // (50 + 3) / (100 + 4) = 53/104 ≈ 50.96 → redondeado 51
    expect(aggregateProgress([{ x: 50, y: 100 }, { x: 3, y: 4 }])).toBe(51);
  });
  it("sin grupos o sin denominador → 0", () => {
    expect(aggregateProgress([])).toBe(0);
    expect(aggregateProgress([{ x: 5, y: 0 }])).toBe(0);
  });
});

describe("Preservación de datos: backup/restauración e idempotencia", () => {
  const state = {
    user_id: "u-1",
    goals: [{ id: "g-1", title: "Meta A", progress: 40 }],
    tasks: [{ id: "t-1", text: "X", completed: false }],
    finance: { cash: 5000, nested: { a: 1 } },
  };

  it("backup profundo no comparte referencias (restaurar == original, IDs intactos)", () => {
    const backup = deepClone(state);
    expect(isEqualJson(backup, state)).toBe(true);
    // modificar el backup no afecta al original
    (backup.tasks[0] as { text: string }).text = "CAMBIADO";
    (backup.finance as { cash: number }).cash = 0;
    expect(state.tasks[0].text).toBe("X");
    expect(state.finance.cash).toBe(5000);
    // restaurar desde un segundo clon devuelve el estado idéntico
    const restored = deepClone(state);
    expect(isEqualJson(restored, state)).toBe(true);
    expect(restored.goals[0].id).toBe("g-1"); // IDs y relaciones conservadas
  });

  it("backup es idempotente: ejecutar N veces no cambia el original", () => {
    const before = JSON.stringify(state);
    deepClone(state);
    deepClone(state);
    deepClone(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("mergeUserCollections no mezcla datos de otro usuario (reemplaza, no concatena)", () => {
    const userA = { tasks: [task({ id: "a1" })], goals: [goal({ id: "ga" })] };
    const userB = { tasks: [task({ id: "b1" })] };
    const merged = mergeUserCollections(userA, userB);
    expect(merged.tasks).toEqual([userB.tasks[0]]);
    expect(merged.goals).toEqual(userA.goals);
    expect(merged.tasks.find(t => t.id === "a1")).toBeUndefined(); // no cruce entre usuarios
  });
});
