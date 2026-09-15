// ─────────────────────────────────────────────────────────────────────────────
// Goal Assist 90 · Metas del mes/trimestre y comisiones con abonos parciales
//  - Matemática de períodos (mes y trimestre) sin riesgos de zona horaria.
//  - Regla de negocio central: SOLO las comisiones TOTALMENTE liquidadas suman.
//  - Bandas de color/emoji/mensaje del progreso.
//  - Abonos parciales, estados 🔴/🟡/🟢 y anulación auditada (nunca borrado).
//  - Bitácora de reajustes de meta (append-only) y meta histórica por período.
//  - Pureza: las funciones no mutan las colecciones que reciben.
//  - Integración: la UI y la persistencia en la nube existen en App.tsx.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Commission,
  type CommissionPayment,
  type GoalAdjustment,
  applyGoalTarget,
  addCommission,
  addPayment,
  adjustmentsOf,
  canDeleteCommission,
  commissionView,
  commissionsInPeriod,
  createCommission,
  createPayment,
  effectiveGoalMonth,
  getGoalProgressData,
  getProgressColor,
  getProgressEmoji,
  makeId,
  monthInPeriod,
  monthLabelEs,
  motivationalMessage,
  normalizeDate,
  normalizeMonth,
  paidAmountOf,
  periodFor,
  periodSummary,
  progressBand,
  quarterLabelEs,
  quarterOfMonth,
  recentPeriods,
  recalcCommission,
  removeCommissionIfEmpty,
  remainingOf,
  round2,
  settledAtOf,
  settledTotalOf,
  inProcessTotalOf,
  shiftMonth,
  sortCommissions,
  statusOf,
  targetForPeriod,
  totalOf,
  updateCommission,
  validateCommissionInput,
  validatePaymentInput,
  voidPayment,
  archivedCommissions,
  deleteCommission,
  editCommission,
  isDeleted,
  liveCommissions,
  restoreCommission,
  validateCommissionEdit,
} from "../src/lib/commissions";

const TODAY = "2026-08-15";
const NOW = "2026-08-15T12:00:00.000Z";

/** Comisión de prueba con id/valores controlados. */
function com(
  id: string,
  total: number,
  goalMonth = "2026-08",
  commissionDate = `${goalMonth}-05`,
): Commission {
  return createCommission(
    { description: `Comisión ${id}`, totalAmount: total, commissionDate, goalMonth },
    { id, now: NOW },
  );
}

/** Abono de prueba. */
function pay(id: string, amount: number, date: string, note?: string): CommissionPayment {
  return createPayment({ amount, date, note }, { id, now: NOW });
}

/** Aplica abonos a una comisión de forma pura. */
function withPayments(commission: Commission, payments: CommissionPayment[]): Commission {
  return recalcCommission({ ...commission, payments });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Utilidades de fecha y período", () => {
  it("normaliza fechas y meses sin tocar la zona horaria", () => {
    expect(normalizeDate("2026-08-15")).toBe("2026-08-15");
    expect(normalizeDate("2026-08")).toBe("2026-08-01");
    expect(normalizeDate("2026-08-15T23:30:00-06:00")).toBe("2026-08-15");
    expect(normalizeDate("")).toBe("");
    expect(normalizeDate("15/08/2026")).toBe("");
    expect(normalizeMonth("2026-08-15")).toBe("2026-08");
    expect(normalizeMonth("2026-13")).toBe("");
    expect(normalizeMonth("no-es-fecha")).toBe("");
  });

  it("suma y resta meses sin desbordes de fecha", () => {
    expect(shiftMonth("2026-08", -1)).toBe("2026-07");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-08", -9)).toBe("2025-11");
    expect(shiftMonth("", -1)).toBe("");
  });

  it("mes: clave, inicio, fin y etiqueta", () => {
    const p = periodFor("monthly", TODAY);
    expect(p.key).toBe("2026-08");
    expect(p.start).toBe("2026-08-01");
    expect(p.end).toBe("2026-08-31");
    expect(p.label).toBe("Agosto 2026");
    expect(monthLabelEs("2026-02")).toBe("Febrero 2026");
  });

  it("trimestre: agrupa julio–septiembre como Q3 con etiqueta legible", () => {
    const p = periodFor("quarterly", TODAY);
    expect(p.key).toBe("2026-Q3");
    expect(p.start).toBe("2026-07-01");
    expect(p.end).toBe("2026-09-30");
    expect(p.label).toBe("Q3 2026 (Jul–Sep)");
    expect(quarterOfMonth("2026-01")).toBe(1);
    expect(quarterOfMonth("2026-03")).toBe(1);
    expect(quarterOfMonth("2026-04")).toBe(2);
    expect(quarterOfMonth("2026-12")).toBe(4);
    expect(quarterLabelEs(2025, 1)).toBe("Q1 2025 (Ene–Mar)");
  });

  it("recentPeriods devuelve períodos anteriores en orden descendente", () => {
    expect(recentPeriods("monthly", TODAY, 3).map(p => p.key)).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(recentPeriods("quarterly", TODAY, 3).map(p => p.key)).toEqual(["2026-Q3", "2026-Q2", "2026-Q1"]);
  });

  it("monthInPeriod reconoce meses dentro del rango", () => {
    const q = periodFor("quarterly", TODAY);
    expect(monthInPeriod("2026-07", q)).toBe(true);
    expect(monthInPeriod("2026-09", q)).toBe(true);
    expect(monthInPeriod("2026-06", q)).toBe(false);
    expect(monthInPeriod("2026-10", q)).toBe(false);
    expect(monthInPeriod("", q)).toBe(false);
  });
});

describe("Comisiones: estado derivado (🔴 pendiente · 🟡 en proceso · 🟢 liquidada)", () => {
  it("sin abonos queda pendiente y no aporta nada", () => {
    const c = com("c1", 1000);
    expect(statusOf(c)).toBe("pending");
    expect(paidAmountOf(c)).toBe(0);
    expect(remainingOf(c)).toBe(1000);
    expect(commissionView(c).percentage).toBe(0);
    expect(settledAtOf(c)).toBeUndefined();
  });

  it("un abono parcial la deja en proceso con su saldo pendiente", () => {
    const c = withPayments(com("c2", 1000), [pay("p1", 400, "2026-08-10")]);
    expect(statusOf(c)).toBe("partial");
    expect(paidAmountOf(c)).toBe(400);
    expect(remainingOf(c)).toBe(600);
    expect(commissionView(c).percentage).toBe(40);
    expect(commissionView(c).paymentCount).toBe(1);
  });

  it("al cubrir el total queda liquidada con la fecha del abono que la cerró", () => {
    const c = withPayments(com("c3", 1000), [
      pay("p1", 400, "2026-08-10"),
      pay("p2", 300, "2026-08-20"),
      pay("p3", 300, "2026-08-28"),
    ]);
    expect(statusOf(c)).toBe("paid");
    expect(paidAmountOf(c)).toBe(1000);
    expect(remainingOf(c)).toBe(0);
    expect(commissionView(c).percentage).toBe(100);
    expect(settledAtOf(c)).toBe("2026-08-28");
  });

  it("no se puede superar el total: un abono de más no altera el estado", () => {
    const c = withPayments(com("c4", 1000), [pay("p1", 1200, "2026-08-10")]);
    expect(statusOf(c)).toBe("paid");
    expect(remainingOf(c)).toBe(0);
  });

  it("los abonos anulados se conservan pero no cuentan", () => {
    const base = withPayments(com("c5", 1000), [pay("p1", 400, "2026-08-10"), pay("p2", 600, "2026-08-12")]);
    expect(statusOf(base)).toBe("paid");

    const voided = voidPayment([base], "c5", "p2", NOW)[0];
    expect(statusOf(voided)).toBe("partial");
    expect(paidAmountOf(voided)).toBe(400);
    // auditoría: el abono sigue ahí, marcado como anulado
    expect(voided.payments).toHaveLength(2);
    const p2 = voided.payments.find(p => p.id === "p2") as CommissionPayment;
    expect(p2.voided).toBe(true);
    expect(p2.voidedAt).toBe(NOW);
    expect(commissionView(voided).voidedCount).toBe(1);
  });

  it("un abono registrado no se puede anular dos veces ni resucita el estado", () => {
    const base = withPayments(com("c6", 500), [pay("p1", 500, "2026-08-10")]);
    const once = voidPayment([base], "c6", "p1", NOW);
    const twice = voidPayment(once, "c6", "p1", "2026-09-01T00:00:00.000Z");
    expect(twice[0].payments[0].voidedAt).toBe(NOW);
    expect(statusOf(twice[0])).toBe("pending");
  });

  it("no se elimina una comisión con historial de abonos (ni anulados)", () => {
    const conAbonos = withPayments(com("c7", 1000), [pay("p1", 100, "2026-08-10")]);
    expect(canDeleteCommission(conAbonos)).toBe(false);
    expect(removeCommissionIfEmpty([conAbonos], "c7")).toHaveLength(1);

    const anulados = voidPayment([conAbonos], "c7", "p1", NOW)[0];
    expect(canDeleteCommission(anulados)).toBe(false);
    expect(removeCommissionIfEmpty([anulados], "c7")).toHaveLength(1);
  });

  it("solo una comisión sin ningún abono registrado puede eliminarse", () => {
    const vacia = com("c8", 300);
    expect(canDeleteCommission(vacia)).toBe(true);
    expect(removeCommissionIfEmpty([vacia], "c8")).toHaveLength(0);
    // id inexistente: la colección no cambia
    expect(removeCommissionIfEmpty([vacia], "otro")).toHaveLength(1);
  });

  it("mes objetivo efectivo: respeta goalMonth y cae a la fecha de la comisión", () => {
    expect(effectiveGoalMonth(com("c9", 100, "2026-09"))).toBe("2026-09");
    const sinMes = recalcCommission({ ...com("c10", 100), goalMonth: "" });
    expect(effectiveGoalMonth(sinMes)).toBe("2026-08");
  });
});

describe("Progreso de metas: SOLO lo liquidado suma", () => {
  const liquida = withPayments(com("a1", 500, "2026-08"), [pay("a1p", 500, "2026-08-12")]);
  const enProceso = withPayments(com("a2", 800, "2026-08"), [pay("a2p", 300, "2026-08-13")]);
  const pendiente = com("a3", 900, "2026-08");
  const liquidaJulio = withPayments(com("a4", 200, "2026-07"), [pay("a4p", 200, "2026-07-20")]);

  it("las pendientes y en proceso NO suman al dashboard", () => {
    const g = getGoalProgressData([liquida, enProceso, pendiente], 1000, "monthly", TODAY);
    expect(g.current).toBe(500);
    expect(g.percentage).toBe(50);
    expect(g.remaining).toBe(500);
    expect(g.settledCount).toBe(1);
    expect(g.inProcessCount).toBe(1);
    expect(g.pendingCount).toBe(1);
    // el dinero ya abonado se muestra aparte, nunca dentro del progreso
    expect(g.inProcessAmount).toBe(300);
    expect(g.achieved).toBe(false);
  });

  it("una comisión en proceso que se liquida pasa a contar de inmediato", () => {
    const antes = getGoalProgressData([enProceso], 1000, "monthly", TODAY);
    expect(antes.current).toBe(0);
    const despues = getGoalProgressData(
      [withPayments(enProceso, [...enProceso.payments, pay("a2p2", 500, "2026-08-20")])],
      1000,
      "monthly",
      TODAY,
    );
    expect(despues.current).toBe(800);
    expect(despues.percentage).toBe(80);
  });

  it("atribuye por mes objetivo y no por fecha de registro", () => {
    const movida = recalcCommission({ ...liquida, goalMonth: "2026-09" });
    const agosto = getGoalProgressData([movida], 1000, "monthly", TODAY);
    const septiembre = getGoalProgressData([movida], 1000, "monthly", "2026-09-10");
    expect(agosto.current).toBe(0);
    expect(septiembre.current).toBe(500);
  });

  it("el trimestre acumula los tres meses y excluye los externos", () => {
    const delTrimestre = [liquida, liquidaJulio]; // agosto + julio
    const q = getGoalProgressData(delTrimestre, 1000, "quarterly", TODAY);
    expect(q.period.key).toBe("2026-Q3");
    expect(q.current).toBe(700);
    expect(q.percentage).toBe(70);

    const fuera = withPayments(com("a5", 400, "2026-06"), [pay("a5p", 400, "2026-06-20")]);
    const q2 = getGoalProgressData([...delTrimestre, fuera], 1000, "quarterly", TODAY);
    expect(q2.current).toBe(700);
  });

  it("supera el 100% sin desbordar la celebración", () => {
    const g = getGoalProgressData([liquida, liquidaJulio], 500, "monthly", TODAY);
    expect(g.current).toBe(500);
    expect(g.percentage).toBe(100);
    expect(g.achieved).toBe(true);
    const g2 = getGoalProgressData([liquida], 400, "monthly", TODAY);
    expect(g2.percentage).toBe(125);
    expect(g2.remaining).toBe(0);
    expect(g2.emoji).toBe("🏆");
    expect(g2.bandLabel).toBe("Meta alcanzada");
    expect(g2.message).toContain("Meta cumplida");
  });

  it("sin meta definida no hay NaN ni división por cero", () => {
    for (const target of [0, -100, Number.NaN]) {
      const g = getGoalProgressData([liquida], target, "monthly", TODAY);
      expect(g.hasTarget).toBe(false);
      expect(g.percentage).toBe(0);
      expect(Number.isFinite(g.percentage)).toBe(true);
      expect(Number.isFinite(g.remaining)).toBe(true);
      expect(g.achieved).toBe(false);
    }
  });

  it("una fecha inválida no rompe el cálculo", () => {
    const g = getGoalProgressData([liquida], 1000, "monthly", "fecha-mala");
    expect(g.period.key).toBe("");
    expect(g.current).toBe(0);
    expect(g.percentage).toBe(0);
  });

  it("colecciones vacías o incompletas son seguras", () => {
    expect(settledTotalOf([])).toBe(0);
    // datos heredados sin arreglo de abonos
    const legacy = { id: "x", description: "vieja", totalAmount: 100, commissionDate: "2026-08-01", goalMonth: "2026-08" } as Commission;
    expect(statusOf(legacy)).toBe("pending");
    expect(totalOf(legacy)).toBe(100);
    expect(paidAmountOf(legacy)).toBe(0);
  });

  it("totales del período: liquidado, en proceso y pendiente por separado", () => {
    const sum = periodSummary([liquida, enProceso, pendiente, liquidaJulio], "monthly", TODAY);
    expect(sum.count).toBe(3);
    expect(sum.settled).toBe(500);
    expect(sum.inProcess).toBe(300);
    expect(sum.pending).toBe(900);
    // el total del período suma los montos comprometidos (julio queda fuera)
    expect(sum.total).toBe(500 + 800 + 900);
    expect(settledTotalOf([liquida, enProceso, pendiente])).toBe(500);
    expect(inProcessTotalOf([liquida, enProceso, pendiente])).toBe(300);
  });

  it("ordena primero lo que está en proceso (lo que requiere acción)", () => {
    const orden = sortCommissions([pendiente, liquida, enProceso]).map(c => c.id);
    expect(orden).toEqual(["a2", "a3", "a1"]);
  });
});

describe("Bandas de color, emoji y mensaje motivacional", () => {
  it("cada rango usa su color corporativo", () => {
    expect(getProgressColor(0)).toBe("#EF4444");
    expect(getProgressColor(25)).toBe("#EF4444");
    expect(getProgressColor(26)).toBe("#F97316");
    expect(getProgressColor(50)).toBe("#F97316");
    expect(getProgressColor(51)).toBe("#FACC15");
    expect(getProgressColor(75)).toBe("#FACC15");
    expect(getProgressColor(76)).toBe("#34D399");
    expect(getProgressColor(90)).toBe("#34D399");
    expect(getProgressColor(91)).toBe("#10B981");
    expect(getProgressColor(100)).toBe("#10B981");
    expect(getProgressColor(1000)).toBe("#10B981");
  });

  it("el emoji acompaña el avance", () => {
    expect(getProgressEmoji(10)).toBe("🌱");
    expect(getProgressEmoji(40)).toBe("🚀");
    expect(getProgressEmoji(60)).toBe("💪");
    expect(getProgressEmoji(85)).toBe("🔥");
    expect(getProgressEmoji(100)).toBe("🏆");
  });

  it("los porcentajes fuera de rango se acotan (sin NaN)", () => {
    expect(progressBand(-5).max).toBe(25);
    expect(progressBand(Number.NaN).max).toBe(25);
    expect(progressBand(999).label).toBe("Meta alcanzada");
  });

  it("el mensaje es distinto en cada banda y celebra al cumplir", () => {
    const mensajes = [10, 40, 60, 85].map(p => motivationalMessage(p));
    expect(new Set(mensajes).size).toBe(4);
    expect(motivationalMessage(20)).toBe(progressBand(20).message);
    expect(motivationalMessage(100, true)).toContain("Meta cumplida");
    expect(motivationalMessage(100, true)).not.toBe(motivationalMessage(100));
  });
});

describe("Validación de formularios", () => {
  it("rechaza comisiones incompletas o con montos inválidos", () => {
    expect(validateCommissionInput("", 100, TODAY)).toMatch(/descripción/i);
    expect(validateCommissionInput("Venta", 0, TODAY)).toMatch(/mayor a 0/i);
    expect(validateCommissionInput("Venta", -5, TODAY)).toMatch(/mayor a 0/i);
    expect(validateCommissionInput("Venta", Number.NaN, TODAY)).toMatch(/mayor a 0/i);
    expect(validateCommissionInput("Venta", 100, "mal")).toMatch(/fecha/i);
    expect(validateCommissionInput("Venta", 100, TODAY)).toBeNull();
  });

  it("no permite abonar más que el saldo pendiente ni abonar a una liquidada", () => {
    const c = withPayments(com("v1", 1000), [pay("p1", 400, "2026-08-10")]);
    expect(validatePaymentInput(c, 700, TODAY)).toMatch(/no puede superar/i);
    expect(validatePaymentInput(c, 0, TODAY)).toMatch(/mayor a 0/i);
    expect(validatePaymentInput(c, 600, "mal")).toMatch(/fecha/i);
    expect(validatePaymentInput(c, 600, TODAY)).toBeNull();

    const pagada = withPayments(com("v2", 1000), [pay("p2", 1000, "2026-08-10")]);
    expect(validatePaymentInput(pagada, 50, TODAY)).toMatch(/ya está liquidada/i);
  });
});

describe("Actualizadores puros (sin mutar el estado)", () => {
  it("agregar es idempotente por id y no duplica comisiones", () => {
    const c = com("n1", 100);
    const one = addCommission([], c);
    const two = addCommission(one, c);
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    // no-op real: ni duplica ni muta lo ya guardado
    expect(two).toEqual(one);
    expect(one).toHaveLength(1);
  });

  it("editar conserva id, abonos e historial", () => {
    const c = withPayments(com("n2", 1000), [pay("p1", 200, "2026-08-10")]);
    const editada = updateCommission([c], "n2", { description: "Nueva", totalAmount: 2000 })[0];
    expect(editada.id).toBe("n2");
    expect(editada.description).toBe("Nueva");
    expect(editada.payments).toHaveLength(1);
    expect(statusOf(editada)).toBe("partial");
    expect(remainingOf(editada)).toBe(1800);
  });

  it("registrar un abono no toca otras comisiones", () => {
    const a = com("n3", 100);
    const b = com("n4", 100);
    const out = addPayment([a, b], "n4", pay("p9", 100, "2026-08-10"));
    expect(statusOf(out[0])).toBe("pending");
    expect(statusOf(out[1])).toBe("paid");
  });

  it("recalcCommission espeja los derivados sin alterar los abonos", () => {
    const c = recalcCommission(withPayments(com("n5", 100), [pay("p1", 100, "2026-08-10")]));
    expect(c.paidAmount).toBe(100);
    expect(c.status).toBe("paid");
    expect(c.settledAt).toBe("2026-08-10");
    expect(c.payments).toHaveLength(1);
  });

  it("las funciones no mutan las colecciones ni los objetos recibidos", () => {
    const c = com("n6", 1000);
    const list = [c];
    const before = JSON.stringify(list);
    addPayment(list, "n6", pay("p1", 100, "2026-08-10"));
    updateCommission(list, "n6", { description: "Cambio" });
    voidPayment(list, "n6", "p1", NOW);
    removeCommissionIfEmpty(list, "n6");
    recalcCommission(c);
    applyGoalTarget(
      { monthlyGoal: { target: 1000 }, quarterlyGoal: { target: 1000 }, goalAdjustments: [] },
      "monthly",
      2000,
      TODAY,
    );
    expect(JSON.stringify(list)).toBe(before);
  });

  it("round2 evita basura de punto flotante", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(1234.567)).toBe(1234.57);
  });

  it("makeId genera ids únicos y legibles", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeId("t")));
    expect(ids.size).toBe(50);
    expect([...ids][0].startsWith("t_")).toBe(true);
  });
});

describe("Bitácora de reajustes de meta", () => {
  const base = { monthlyGoal: { target: 10000 }, quarterlyGoal: { target: 30000 }, goalAdjustments: [] as GoalAdjustment[] };

  it("reajustar cambia el valor vigente y deja registro del cambio", () => {
    const out = applyGoalTarget(base, "monthly", 15000, TODAY, "Subo la meta", { id: "adj1", now: NOW });
    expect(out.monthlyGoal.target).toBe(15000);
    expect(out.quarterlyGoal.target).toBe(30000);
    expect(out.goalAdjustments).toHaveLength(1);
    const a = out.goalAdjustments[0];
    expect(a).toMatchObject({ id: "adj1", type: "monthly", periodKey: "2026-08", from: 10000, to: 15000, note: "Subo la meta" });
    expect(a.periodStart).toBe("2026-08-01");
    expect(a.periodEnd).toBe("2026-08-31");
    expect(a.at).toBe(NOW);
    // el estado original no se toca
    expect(base.monthlyGoal.target).toBe(10000);
    expect(base.goalAdjustments).toHaveLength(0);
  });

  it("es idempotente: mismo monto no genera registros ni cambios", () => {
    const out = applyGoalTarget(base, "monthly", 10000, TODAY, "sin cambio", { id: "adj1", now: NOW });
    expect(out.goalAdjustments).toHaveLength(0);
    expect(out.monthlyGoal.target).toBe(10000);
  });

  it("nunca acepta metas negativas ni valores no numéricos", () => {
    const neg = applyGoalTarget(base, "monthly", -500, TODAY, undefined, { id: "adj_neg", now: NOW });
    expect(neg.monthlyGoal.target).toBe(0);
    const nan = applyGoalTarget(base, "quarterly", Number.NaN, TODAY, undefined, { id: "adj_nan", now: NOW });
    expect(nan.quarterlyGoal.target).toBe(0);
  });

  it("el trimestre reajusta su propio tipo y registra la clave Qn", () => {
    const out = applyGoalTarget(base, "quarterly", 45000, TODAY, undefined, { id: "adj2", now: NOW });
    expect(out.quarterlyGoal.target).toBe(45000);
    expect(out.monthlyGoal.target).toBe(10000);
    expect(out.goalAdjustments[0].periodKey).toBe("2026-Q3");
    expect(out.goalAdjustments[0].type).toBe("quarterly");
  });

  it("conserva la bitácora previa y la lista más reciente primero", () => {
    const e1 = applyGoalTarget(base, "monthly", 12000, "2026-02-10", undefined, { id: "a", now: "2026-02-10T10:00:00.000Z" });
    const e2 = applyGoalTarget(e1, "monthly", 18000, "2026-05-10", undefined, { id: "b", now: "2026-05-10T10:00:00.000Z" });
    expect(e2.goalAdjustments).toHaveLength(2);
    expect(adjustmentsOf(e2.goalAdjustments, "monthly").map(a => a.id)).toEqual(["b", "a"]);
    expect(adjustmentsOf(e2.goalAdjustments, "quarterly")).toHaveLength(0);
    expect(adjustmentsOf(e2.goalAdjustments)).toHaveLength(2);
  });

  it("targetForPeriod reconstruye la meta vigente de cada período", () => {
    const e1 = applyGoalTarget(base, "monthly", 12000, "2026-02-10", undefined, { id: "a", now: "2026-02-10T10:00:00.000Z" });
    const e2 = applyGoalTarget(e1, "monthly", 18000, "2026-04-10", undefined, { id: "b", now: "2026-04-10T10:00:00.000Z" });
    const log = e2.goalAdjustments;
    expect(targetForPeriod(log, "monthly", 18000, "2026-Q3")).toBe(18000);
    expect(targetForPeriod(log, "monthly", 18000, "2026-02")).toBe(12000);
    expect(targetForPeriod(log, "monthly", 18000, "2026-03")).toBe(12000);
    expect(targetForPeriod(log, "monthly", 18000, "2026-04")).toBe(18000);
    expect(targetForPeriod(log, "monthly", 18000, "2026-05")).toBe(18000);
  });

  it("si todos los reajustes son posteriores, devuelve la meta anterior", () => {
    const fut = applyGoalTarget(base, "monthly", 20000, "2026-10-05", undefined, { id: "f", now: "2026-10-05T10:00:00.000Z" });
    expect(targetForPeriod(fut.goalAdjustments, "monthly", 20000, "2026-02")).toBe(10000);
  });

  it("sin bitácora del tipo pedido, devuelve la meta vigente actual", () => {
    expect(targetForPeriod([], "monthly", 10000, "2026-08")).toBe(10000);
    const soloTrimestral = applyGoalTarget(base, "quarterly", 40000, TODAY, undefined, { id: "q", now: NOW });
    expect(targetForPeriod(soloTrimestral.goalAdjustments, "monthly", 10000, "2026-08")).toBe(10000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Comisiones registradas: editar y eliminar (sin perder datos)", () => {
  it("editCommission actualiza los datos y conserva id, abonos e historial", () => {
    const c = withPayments(com("e1", 1000), [pay("p1", 400, "2026-08-10")]);
    const out = editCommission([c], "e1", {
      description: "Cliente corregido",
      totalAmount: 1200,
      commissionDate: "2026-07-20",
      goalMonth: "2026-09",
    });
    const e = out[0];
    expect(out).toHaveLength(1);
    expect(e.id).toBe("e1");
    expect(e.description).toBe("Cliente corregido");
    expect(totalOf(e)).toBe(1200);
    expect(e.commissionDate).toBe("2026-07-20");
    expect(effectiveGoalMonth(e)).toBe("2026-09");
    expect(e.payments).toHaveLength(1);
    expect(e.payments[0].amount).toBe(400);
    expect(e.payments[0].date).toBe("2026-08-10");
    expect(paidAmountOf(e)).toBe(400);
    expect(statusOf(e)).toBe("partial");
  });

  it("editar puede liquidar una comisión (el abono ya cubre el nuevo total)", () => {
    const c = withPayments(com("e2", 1000), [pay("p1", 400, "2026-08-10")]);
    const e = editCommission([c], "e2", {
      description: c.description,
      totalAmount: 400,
      commissionDate: c.commissionDate,
      goalMonth: c.goalMonth,
    })[0];
    expect(statusOf(e)).toBe("paid");
    expect(remainingOf(e)).toBe(0);
    expect(settledAtOf(e)).toBe("2026-08-10");
  });

  it("la edición nunca deja el total por debajo de lo ya abonado", () => {
    const c = withPayments(com("e3", 1000), [pay("p1", 600, "2026-08-10")]);
    expect(validateCommissionEdit(c, "X", 500, TODAY)).toMatch(/no puede ser menor/i);
    expect(validateCommissionEdit(c, "X", 600, TODAY)).toBeNull();
    expect(validateCommissionEdit(c, "X", 900, TODAY)).toBeNull();
    // las reglas del alta siguen vigentes
    expect(validateCommissionEdit(c, "", 900, TODAY)).toMatch(/descripción/i);
    expect(validateCommissionEdit(c, "X", 0, TODAY)).toMatch(/mayor a 0/i);
    expect(validateCommissionEdit(c, "X", 900, "mal")).toMatch(/fecha/i);
  });

  it("editar una comisión inexistente no altera la colección", () => {
    const list = [com("e4", 100)];
    expect(editCommission(list, "otro", {
      description: "Nada", totalAmount: 50, commissionDate: TODAY, goalMonth: "2026-08",
    })).toHaveLength(1);
    expect(editCommission(list, "otro", {
      description: "Nada", totalAmount: 50, commissionDate: TODAY, goalMonth: "2026-08",
    })[0].description).toBe("Comisión e4");
  });

  it("deleteCommission borra físicamente solo si no hay abonos registrados", () => {
    const vacia = com("d1", 300);
    const r = deleteCommission([vacia], "d1");
    expect(r.mode).toBe("deleted");
    expect(r.commissions).toHaveLength(0);
    // con abonos (aunque estén anulados) nunca se borra: se archiva
    const conAbonos = withPayments(com("d2", 300), [pay("p1", 100, "2026-08-10")]);
    const r2 = deleteCommission([conAbonos], "d2");
    expect(r2.mode).toBe("archived");
    expect(r2.commissions).toHaveLength(1);
    expect(isDeleted(r2.commissions[0])).toBe(true);
    expect(r2.commissions[0].payments).toHaveLength(1);
    // id inexistente: no-op
    expect(deleteCommission([vacia], "otro").mode).toBe("not-found");
  });

  it("una comisión eliminada deja de contar para la meta y de listarse", () => {
    const pagada = withPayments(com("d3", 1000), [pay("p1", 1000, "2026-08-10")]);
    const otras = [com("d4", 500)];
    const antes = getGoalProgressData([pagada, ...otras], 1000, "monthly", TODAY);
    expect(antes.current).toBe(1000);
    expect(antes.percentage).toBe(100);

    const { commissions: despues } = deleteCommission([pagada, ...otras], "d3");
    const meta = getGoalProgressData(despues, 1000, "monthly", TODAY);
    expect(meta.current).toBe(0);
    expect(meta.settledCount).toBe(0);
    expect(periodSummary(despues, "monthly", TODAY).settled).toBe(0);
    expect(commissionsInPeriod(despues, periodFor("monthly", TODAY))).toHaveLength(1);
    expect(liveCommissions(despues).map(c => c.id)).toEqual(["d4"]);
    expect(archivedCommissions(despues).map(c => c.id)).toEqual(["d3"]);
    expect(sortCommissions(liveCommissions(despues)).map(c => c.id)).toEqual(["d4"]);
  });

  it("restoreCommission devuelve la comisión a la vista y a la meta con su historial", () => {
    const pagada = withPayments(com("d5", 1000), [pay("p1", 1000, "2026-08-10")]);
    const { commissions: archivada } = deleteCommission([pagada], "d5", { now: NOW });
    const restored = restoreCommission(archivada, "d5", { now: "2026-08-20T00:00:00.000Z" })[0];
    expect(isDeleted(restored)).toBe(false);
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.payments).toHaveLength(1);
    expect(restored.status).toBe("paid");
    expect(getGoalProgressData([restored], 1000, "monthly", TODAY).current).toBe(1000);
    // restaurar algo que no está archivado es no-op
    expect(restoreCommission([restored], "d5")[0].deletedAt).toBeUndefined();
  });

  it("editar una comisión archivada no la resucita", () => {
    const { commissions: archivada } = deleteCommission([com("d6", 100)], "d6");
    expect(liveCommissions(archivada)).toHaveLength(0);
    const editada = editCommission([{ ...archivada[0], deletedAt: NOW, payments: [pay("p1", 10, "2026-08-10")] }], "d6", {
      description: "Tocada", totalAmount: 200, commissionDate: TODAY, goalMonth: "2026-08",
    })[0];
    expect(isDeleted(editada)).toBe(true);
    expect(liveCommissions([editada])).toHaveLength(0);
  });

  it("eliminar/editar/restaurar no mutan las colecciones recibidas", () => {
    const c = withPayments(com("d7", 1000), [pay("p1", 200, "2026-08-10")]);
    const list = [c];
    const before = JSON.stringify(list);
    editCommission(list, "d7", { description: "Otra", totalAmount: 900, commissionDate: TODAY, goalMonth: "2026-08" });
    const { commissions: archived } = deleteCommission(list, "d7", { now: NOW });
    restoreCommission(archived, "d7");
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe("Integración con la app (App.tsx y persistencia en la nube)", () => {
  let app = "";
  beforeAll(() => {
    app = readFileSync(join(process.cwd(), "src/app/App.tsx"), "utf8");
  });

  it("el dashboard Hoy muestra las tarjetas de meta del mes y del trimestre", () => {
    expect(app).toContain("Meta del Mes");
    expect(app).toContain("Meta Trimestral");
  });

  it("Hoy es un espejo de Metas: las metas se editan en Metas, nunca al revés", () => {
    const start = app.indexOf("function HoyTab(");
    const end = app.indexOf("function HabitosTab(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const hoy = app.slice(start, end);
    // Hoy NO escribe metas ni abre el editor de metas (solo las refleja).
    expect(hoy).not.toMatch(/applyGoalTarget\(/);
    expect(hoy).not.toContain("GoalEditor");
    expect(hoy).not.toContain("saveGoalTarget");
    expect(hoy).not.toContain("setGoalEditor");
    // sus tarjetas de meta solo llevan a la pestaña Metas
    expect(hoy).toContain('onManage={() => onGoTo("metas")}');
    expect((hoy.match(/onManage=/g) || []).length).toBe(2);
    // la tarjeta es de solo lectura y lo dice explícitamente
    const card = app.slice(app.indexOf("function GoalCard("), app.indexOf("function GoalEditor("));
    expect(card).toContain("Editar en Metas");
    expect(card).not.toContain("onEdit");
    // y Metas (CapitalTab) sigue siendo la única superficie de edición de metas
    expect(app).toContain("Configuración de Metas");
    expect(app).toMatch(/applyGoalTarget\(/);
    const capital = app.slice(app.indexOf("function CapitalTab("));
    expect(capital).toContain("GoalsConfigSection");
  });

  it("la pestaña Metas incluye configuración de metas, comisiones y abonos", () => {
    expect(app).toContain("Configuración de Metas");
    expect(app).toContain("Comisiones y Abonos");
    expect(app).toContain("Nuevo abono");
  });

  it("los componentes del diseño están implementados", () => {
    for (const comp of [
      "function GoalCard",
      "function MotivationalMessage",
      "function CommissionCard",
      "function PaymentForm",
      "function CommissionForm",
      "function GoalEditor",
    ]) {
      expect(app, `falta ${comp}`).toContain(comp);
    }
  });

  it("las metas y comisiones se guardan en la nube por usuario", () => {
    expect(app).toContain('entity: "commissions"');
    expect(app).toContain('entity: "goalAdjustments"');
    // cada entidad se declara una sola vez (una sola fuente de verdad)
    const block = app.slice(app.indexOf("const ENTITY_PERSISTENCE"), app.indexOf("];", app.indexOf("const ENTITY_PERSISTENCE")));
    expect(block.split('entity: "commissions"').length - 1).toBe(1);
    expect(block.split('entity: "goalAdjustments"').length - 1).toBe(1);
  });

  it("los estados 🔴/🟡/🟢 se muestran al usuario", () => {
    expect(app).toContain("🔴");
    expect(app).toContain("🟡");
    expect(app).toContain("🟢");
  });

  it("hay una celebración al alcanzar la meta y un mensaje motivacional dinámico", () => {
    expect(app).toContain("celebrate");
    expect(app).toMatch(/motivationalMessage\(/);
  });

  it("la UI permite editar y eliminar comisiones ya registradas", () => {
    // formulario en modo edición (reutiliza CommissionForm con la comisión actual)
    expect(app).toContain("initial?: Commission | null");
    expect(app).toContain("Editar comisión registrada");
    expect(app).toContain("Guardar cambios");
    expect(app).toMatch(/editCommission\(/);
    expect(app).toMatch(/validateCommissionEdit\(/);
    // borrado disponible siempre en la tarjeta, con confirmación
    expect(app).toContain("onEdit");
    expect(app).toMatch(/deleteCommission\(/);
    expect(app).not.toContain("canDeleteCommission(commission) &&");
    // papelera + restauración (nunca se pierde el historial de abonos)
    expect(app).toMatch(/archivedCommissions\(/);
    expect(app).toMatch(/liveCommissions\(/);
    expect(app).toContain("Papelera");
    expect(app).toContain("Restaurar");
    expect(app).toMatch(/restoreCommission\(/);
  });

  it("la captura sigue siendo manual: sin voz en las comisiones", () => {
    expect(app).not.toContain("useSpeechRecognition");
    expect(app).not.toContain("VoiceRecorder");
  });
});
