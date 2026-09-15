// ─────────────────────────────────────────────────────────────────────────────
// Goal Assistant 90 · Metas del Mes/Trimestre + Comisiones con abonos parciales
// -----------------------------------------------------------------------------
// Módulo PURO (sin React ni Supabase): fuente de verdad para
//   * el progreso de la meta del mes (🌙) y del trimestre (📅),
//   * el estado de cada comisión: pendiente / en proceso / liquidada,
//   * la bitácora de reajustes de meta.
//
// Reglas permanentes de datos:
//   * Nunca muta las colecciones que recibe: todas las funciones son puras y
//     devuelven copias nuevas.
//   * SOLO las comisiones totalmente liquidadas suman al progreso de las metas.
//   * Nada se borra físicamente: los abonos se anulan (voided + voidedAt) y se
//     conservan en el historial. Una comisión SIN abonos se puede eliminar; una
//     comisión CON abonos solo se archiva (deletedAt) y siempre es restaurable,
//     porque su historial de abonos es información del usuario.
//   * El monto de la meta vive en monthlyGoal/quarterlyGoal (una sola fuente de
//     verdad, compatible con los datos históricos del usuario). Este módulo solo
//     registra los REAJUSTES en goalAdjustments (bitácora, nunca el valor actual).
// ─────────────────────────────────────────────────────────────────────────────

export type GoalTargetType = "monthly" | "quarterly";
export type CommissionStatus = "pending" | "partial" | "paid";

export interface CommissionPayment {
  id: string;
  date: string;            // YYYY-MM-DD
  amount: number;
  note?: string;
  voided?: boolean;        // anulación auditada (nunca borrado físico)
  voidedAt?: string;
  createdAt?: string;
}

export interface Commission {
  id: string;
  description: string;
  totalAmount: number;
  commissionDate: string;  // fecha en que se generó la comisión (YYYY-MM-DD)
  goalMonth: string;       // mes objetivo al que suma (YYYY-MM)
  payments: CommissionPayment[];
  // Campos derivados (se recalculan con recalcCommission; la UI siempre los lee
  // del cálculo puro, nunca de estos valores guardados).
  paidAmount?: number;
  status?: CommissionStatus;
  settledAt?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Eliminación auditada: la comisión (y sus abonos) se conserva en la nube,
   *  pero deja de listarse y de contar para las metas. Restaurable. */
  deletedAt?: string;
}

export interface GoalAdjustment {
  id: string;
  type: GoalTargetType;
  periodKey: string;       // "YYYY-MM" (mensual) o "YYYY-Qn" (trimestral)
  periodStart: string;     // YYYY-MM-DD
  periodEnd: string;       // YYYY-MM-DD
  from: number;
  to: number;
  note?: string;
  at: string;              // ISO timestamp del reajuste
}

export interface Period {
  type: GoalTargetType;
  key: string;
  start: string;
  end: string;
  label: string;
}

export interface ProgressBand {
  max: number;
  color: string;
  label: string;
  emoji: string;
  message: string;
}

export interface GoalProgress {
  type: GoalTargetType;
  period: Period;
  target: number;
  current: number;
  percentage: number;       // puede superar 100 (la barra se acota en la UI)
  remaining: number;
  hasTarget: boolean;
  achieved: boolean;
  color: string;
  emoji: string;
  message: string;
  bandLabel: string;
  settledCount: number;     // comisiones liquidadas del período
  inProcessCount: number;   // comisiones con abonos, aún no liquidadas
  pendingCount: number;     // comisiones registradas sin abonos
  inProcessAmount: number;  // dinero ya abonado que todavía no cuenta a la meta
}

// ─── Utilidades de fecha (matemática de strings: sin riesgo de zona horaria) ──

function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** "YYYY-MM" | "YYYY-MM-DD" → "YYYY-MM-DD" ("" si no es una fecha válida). */
export function normalizeDate(value: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return "";
}

/** "YYYY-MM" | "YYYY-MM-DD" → "YYYY-MM" ("" si no es válido). */
export function normalizeMonth(value: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return "";
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : "";
}

export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Suma (o resta) meses a un "YYYY-MM" sin desbordes de fecha. */
export function shiftMonth(monthKey: string, delta: number): string {
  const m = normalizeMonth(monthKey);
  if (!m) return "";
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  const total = (y * 12 + (mo - 1)) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return `${ny}-${pad2(nm)}`;
}

export const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function monthLabelEs(monthKey: string): string {
  const m = normalizeMonth(monthKey);
  if (!m) return "—";
  return `${MONTH_NAMES_ES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

/** Trimestre (1-4) al que pertenece un mes "YYYY-MM" (0 si no es válido). */
export function quarterOfMonth(monthKey: string): number {
  const m = normalizeMonth(monthKey);
  if (!m) return 0;
  return Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1;
}

export function quarterLabelEs(year: number, quarter: number): string {
  const start = (quarter - 1) * 3 + 1;
  const a = MONTH_NAMES_ES[start - 1].slice(0, 3);
  const b = MONTH_NAMES_ES[start + 2 - 1].slice(0, 3);
  return `Q${quarter} ${year} (${a}–${b})`;
}

/**
 * Período (mes o trimestre) que contiene la fecha indicada.
 * `key` es el identificador estable: "YYYY-MM" o "YYYY-Qn".
 */
export function periodFor(type: GoalTargetType, dateStr: string): Period {
  const d = normalizeDate(dateStr);
  if (!d) return { type, key: "", start: "", end: "", label: "—" };
  const month = d.slice(0, 7);
  const year = Number(month.slice(0, 4)) || 0;
  const mo = Number(month.slice(5, 7)) || 1;
  if (type === "quarterly") {
    const q = Math.floor((mo - 1) / 3) + 1;
    const startMo = (q - 1) * 3 + 1;
    const endMo = startMo + 2;
    return {
      type,
      key: `${year}-Q${q}`,
      start: `${year}-${pad2(startMo)}-01`,
      end: `${year}-${pad2(endMo)}-${pad2(lastDayOfMonth(year, endMo))}`,
      label: quarterLabelEs(year, q),
    };
  }
  return {
    type,
    key: month,
    start: `${month}-01`,
    end: `${month}-${pad2(lastDayOfMonth(year, mo))}`,
    label: monthLabelEs(month),
  };
}

export function periodKeyOf(type: GoalTargetType, dateStr: string): string {
  return periodFor(type, dateStr).key;
}

/** ¿El mes "YYYY-MM" cae dentro del período? (comparación lexicográfica). */
export function monthInPeriod(monthKey: string, period: Period): boolean {
  const m = normalizeMonth(monthKey);
  if (!m) return false;
  return m >= period.start.slice(0, 7) && m <= period.end.slice(0, 7);
}

/** Períodos recientes (más nuevo primero), incluyendo el de `dateStr`. */
export function recentPeriods(type: GoalTargetType, dateStr: string, count = 6): Period[] {
  const current = periodFor(type, dateStr);
  const out: Period[] = [current];
  for (let i = 1; i < Math.max(1, count); i++) {
    const step = type === "quarterly" ? i * 3 : i;
    const ref = `${shiftMonth(current.start.slice(0, 7), -step)}-01`;
    if (!normalizeDate(ref)) break;
    out.push(periodFor(type, ref));
  }
  return out;
}

// ─── Comisiones: estado derivado ─────────────────────────────────────────────

export const COMMISSION_STATUS_META: Record<CommissionStatus, { label: string; emoji: string; color: string; badge: "red" | "yellow" | "green" }> = {
  pending: { label: "Pendiente", emoji: "🔴", color: "#EF4444", badge: "red" },
  partial: { label: "En proceso", emoji: "🟡", color: "#FACC15", badge: "yellow" },
  paid: { label: "Liquidada", emoji: "🟢", color: "#10B981", badge: "green" },
};

function paymentsOf(c: Commission | null | undefined): CommissionPayment[] {
  return c && Array.isArray(c.payments) ? c.payments.filter(p => p && typeof p === "object") : [];
}

/** Abonos activos (no anulados) ordenados del más antiguo al más reciente. */
export function activePayments(c: Commission): CommissionPayment[] {
  return paymentsOf(c)
    .filter(p => !p.voided)
    .slice()
    .sort((a, b) => {
      const ad = normalizeDate(a.date) || "0000-00-00";
      const bd = normalizeDate(b.date) || "0000-00-00";
      if (ad !== bd) return ad.localeCompare(bd);
      return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
    });
}

/** Total abonado (sin contar abonos anulados). */
export function paidAmountOf(c: Commission): number {
  return round2(activePayments(c).reduce((a, p) => a + (Number(p.amount) || 0), 0));
}

export function totalOf(c: Commission | null | undefined): number {
  return round2(Number(c?.totalAmount) || 0);
}

export function remainingOf(c: Commission): number {
  return round2(Math.max(0, totalOf(c) - paidAmountOf(c)));
}

/** Estado derivado: 🔴 pendiente · 🟡 en proceso · 🟢 liquidada. */
export function statusOf(c: Commission): CommissionStatus {
  const total = totalOf(c);
  const paid = paidAmountOf(c);
  if (total > 0 && paid >= total - 0.005) return "paid";
  if (paid > 0) return "partial";
  return "pending";
}

/** Fecha en la que el acumulado alcanzó el 100% (undefined si no está liquidada). */
export function settledAtOf(c: Commission): string | undefined {
  if (statusOf(c) !== "paid") return undefined;
  const total = totalOf(c);
  let acc = 0;
  for (const p of activePayments(c)) {
    acc += Number(p.amount) || 0;
    if (acc >= total - 0.005) return normalizeDate(p.date) || undefined;
  }
  return undefined;
}

export interface CommissionView {
  paid: number;
  total: number;
  remaining: number;
  percentage: number;
  status: CommissionStatus;
  settledAt?: string;
  paymentCount: number;
  voidedCount: number;
}

/** Vista derivada de una comisión (siempre calculada, nunca leída del guardado). */
export function commissionView(c: Commission): CommissionView {
  const total = totalOf(c);
  const paid = paidAmountOf(c);
  const all = paymentsOf(c);
  return {
    paid,
    total,
    remaining: round2(Math.max(0, total - paid)),
    percentage: total > 0 ? Math.max(0, Math.round((paid / total) * 100)) : 0,
    status: statusOf(c),
    settledAt: settledAtOf(c),
    paymentCount: all.filter(p => !p.voided).length,
    voidedCount: all.filter(p => p.voided).length,
  };
}

/** Recalcula los campos derivados de una comisión (no toca los abonos). */
export function recalcCommission(c: Commission): Commission {
  const v = commissionView(c);
  return {
    ...c,
    payments: paymentsOf(c),
    paidAmount: v.paid,
    status: v.status,
    settledAt: v.settledAt,
    updatedAt: new Date().toISOString(),
  };
}

/** Mes objetivo efectivo: usa goalMonth y, si falta, el mes de la comisión. */
export function effectiveGoalMonth(c: Commission): string {
  const explicit = normalizeMonth(c.goalMonth);
  if (explicit) return explicit;
  return normalizeMonth(normalizeDate(c.commissionDate));
}

/**
 * Comisiones cuyo mes objetivo cae dentro del período indicado.
 * Excluye las archivadas (eliminadas por el usuario): no cuentan para metas.
 */
export function commissionsInPeriod(commissions: Commission[], period: Period): Commission[] {
  const list = Array.isArray(commissions) ? commissions : [];
  return list.filter(c => c && !isDeleted(c) && monthInPeriod(effectiveGoalMonth(c), period));
}

/** Suma de comisiones TOTALMENTE liquidadas (lo único que cuenta a la meta). */
export function settledTotalOf(commissions: Commission[]): number {
  const list = Array.isArray(commissions) ? commissions : [];
  return round2(list.filter(c => c && statusOf(c) === "paid").reduce((a, c) => a + paidAmountOf(c), 0));
}

/** Abonado de comisiones aún no liquidadas (aún no suma a la meta). */
export function inProcessTotalOf(commissions: Commission[]): number {
  const list = Array.isArray(commissions) ? commissions : [];
  return round2(list.filter(c => c && statusOf(c) === "partial").reduce((a, c) => a + paidAmountOf(c), 0));
}

// ─── Progreso de metas: color, emoji y mensaje ───────────────────────────────

export const PROGRESS_BANDS: ProgressBand[] = [
  { max: 25, color: "#EF4444", label: "Arranque", emoji: "🌱", message: "Todo gran resultado empieza con el primer paso. Registra tus comisiones y avanza." },
  { max: 50, color: "#F97316", label: "Tomando ritmo", emoji: "🚀", message: "Vas tomando ritmo. Cada comisión liquidada te acerca a tu meta." },
  { max: 75, color: "#FACC15", label: "Más de la mitad", emoji: "💪", message: "¡Ya pasaste la mitad! Mantén el impulso y cierra lo que está en proceso." },
  { max: 90, color: "#34D399", label: "Muy cerca", emoji: "🔥", message: "¡Estás muy cerca! Liquida las comisiones pendientes y remata la meta." },
  { max: 100, color: "#10B981", label: "Meta alcanzada", emoji: "🏆", message: "¡Meta alcanzada! Celebra el logro y define el siguiente nivel." },
];

/** Banda de color/emoji/mensaje para un porcentaje (0-100 acotado). */
export function progressBand(percentage: number): ProgressBand {
  const p = Math.max(0, Math.min(100, Number(percentage) || 0));
  return PROGRESS_BANDS.find(b => p <= b.max) ?? PROGRESS_BANDS[PROGRESS_BANDS.length - 1];
}

export function getProgressColor(percentage: number): string { return progressBand(percentage).color; }
export function getProgressEmoji(percentage: number): string { return progressBand(percentage).emoji; }

/** Frase motivacional dinámica según el avance (y celebración al 100%). */
export function motivationalMessage(percentage: number, achieved = false): string {
  if (achieved) return "🎉 ¡Meta cumplida! Este logro es tuyo: celébralo y define el siguiente nivel.";
  return progressBand(percentage).message;
}

/**
 * Datos completos de progreso de una meta (mes o trimestre).
 * El monto meta se recibe como parámetro: la fuente de verdad sigue siendo
 * monthlyGoal/quarterlyGoal del estado del usuario.
 */
export function getGoalProgressData(
  commissions: Commission[],
  target: number,
  type: GoalTargetType,
  dateStr: string,
): GoalProgress {
  const period = periodFor(type, dateStr);
  const inPeriod = commissionsInPeriod(commissions, period);
  const t = round2(Number(target) || 0);
  const current = settledTotalOf(inPeriod);
  const percentage = t > 0 ? Math.max(0, Math.round((current / t) * 100)) : 0;
  const achieved = t > 0 && current >= t;
  const band = progressBand(percentage);
  return {
    type,
    period,
    target: t,
    current,
    percentage,
    remaining: round2(Math.max(0, t - current)),
    hasTarget: t > 0,
    achieved,
    color: achieved ? PROGRESS_BANDS[PROGRESS_BANDS.length - 1].color : band.color,
    emoji: achieved ? "🏆" : band.emoji,
    message: motivationalMessage(percentage, achieved),
    bandLabel: achieved ? "Meta alcanzada" : band.label,
    settledCount: inPeriod.filter(c => statusOf(c) === "paid").length,
    inProcessCount: inPeriod.filter(c => statusOf(c) === "partial").length,
    pendingCount: inPeriod.filter(c => statusOf(c) === "pending").length,
    inProcessAmount: inProcessTotalOf(inPeriod),
  };
}

export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

// ─── Validaciones de formularios ─────────────────────────────────────────────

export function validateCommissionInput(description: string, totalAmount: number, dateStr: string): string | null {
  if (!String(description ?? "").trim()) return "La descripción es obligatoria.";
  const total = Number(totalAmount);
  if (!Number.isFinite(total) || total <= 0) return "El monto debe ser mayor a 0.";
  if (!normalizeDate(dateStr)) return "Selecciona una fecha válida.";
  return null;
}

export function validatePaymentInput(commission: Commission, amount: number, dateStr: string): string | null {
  if (statusOf(commission) === "paid") return "Esta comisión ya está liquidada al 100%.";
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return "El abono debe ser mayor a 0.";
  if (!normalizeDate(dateStr)) return "Selecciona una fecha válida.";
  if (amt > remainingOf(commission) + 0.005) {
    return `El abono no puede superar el saldo pendiente (${remainingOf(commission)}).`;
  }
  return null;
}

// ─── Constructores (idempotentes; nunca generan duplicados) ──────────────────

export function makeId(prefix = "ga"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createPayment(
  input: { amount: number; date?: string; note?: string },
  opts?: { id?: string; now?: string; today?: string },
): CommissionPayment {
  const now = opts?.now ?? new Date().toISOString();
  return {
    id: opts?.id ?? makeId("pay"),
    date: normalizeDate(input.date ?? opts?.today ?? now.slice(0, 10)),
    amount: round2(Number(input.amount) || 0),
    note: input.note?.trim() ? input.note.trim() : undefined,
    createdAt: now,
  };
}

export function createCommission(
  input: { description: string; totalAmount: number; commissionDate?: string; goalMonth?: string },
  opts?: { id?: string; now?: string; today?: string },
): Commission {
  const now = opts?.now ?? new Date().toISOString();
  const commissionDate = normalizeDate(input.commissionDate ?? opts?.today ?? now.slice(0, 10));
  return recalcCommission({
    id: opts?.id ?? makeId("com"),
    description: String(input.description ?? "").trim(),
    totalAmount: round2(Number(input.totalAmount) || 0),
    commissionDate,
    goalMonth: normalizeMonth(input.goalMonth ?? "") || commissionDate.slice(0, 7),
    payments: [],
    createdAt: now,
  });
}

// ─── Actualizadores puros de la colección de comisiones ──────────────────────

export function addCommission(commissions: Commission[], commission: Commission): Commission[] {
  const list = Array.isArray(commissions) ? commissions : [];
  if (list.some(c => c.id === commission.id)) return list;
  return [...list, recalcCommission(commission)];
}

export function updateCommission(commissions: Commission[], id: string, patch: Partial<Commission>): Commission[] {
  const list = Array.isArray(commissions) ? commissions : [];
  return list.map(c => (c.id === id ? recalcCommission({ ...c, ...patch, id: c.id, payments: c.payments ?? [] }) : c));
}

export function addPayment(commissions: Commission[], id: string, payment: CommissionPayment): Commission[] {
  const list = Array.isArray(commissions) ? commissions : [];
  return list.map(c => (c.id === id ? recalcCommission({ ...c, payments: [...paymentsOf(c), payment] }) : c));
}

/** Anula un abono (auditoría): nunca se elimina físicamente. */
export function voidPayment(commissions: Commission[], id: string, paymentId: string, nowIso?: string): Commission[] {
  const now = nowIso ?? new Date().toISOString();
  const list = Array.isArray(commissions) ? commissions : [];
  return list.map(c => {
    if (c.id !== id) return c;
    const payments = paymentsOf(c).map(p => (p.id === paymentId && !p.voided ? { ...p, voided: true, voidedAt: now } : p));
    return recalcCommission({ ...c, payments });
  });
}

/**
 * Elimina una comisión SOLO si no tiene abonos registrados (ni activos ni
 * anulados). Si tiene historial de abonos, se conserva para no perder datos.
 */
export function removeCommissionIfEmpty(commissions: Commission[], id: string): Commission[] {
  const list = Array.isArray(commissions) ? commissions : [];
  return list.filter(c => !(c.id === id && paymentsOf(c).length === 0));
}

export function canDeleteCommission(c: Commission): boolean {
  return paymentsOf(c).length === 0;
}

// ─── Editar, eliminar y restaurar comisiones ya registradas ──────────────────

/** ¿La comisión fue eliminada por el usuario? Se conserva archivada en la nube. */
export function isDeleted(c: Commission | null | undefined): boolean {
  return !!(c && c.deletedAt);
}

/** Comisiones vigentes (sin las archivadas): la lista que ve el usuario. */
export function liveCommissions(commissions: Commission[]): Commission[] {
  return (Array.isArray(commissions) ? commissions : []).filter(c => c && !isDeleted(c));
}

/** Comisiones archivadas (papelera): conservan sus abonos y son restaurables. */
export function archivedCommissions(commissions: Commission[]): Commission[] {
  return (Array.isArray(commissions) ? commissions : []).filter(c => c && isDeleted(c));
}

/** Validación de la edición: reglas del alta + nunca bajar de lo ya abonado. */
export function validateCommissionEdit(
  commission: Commission,
  description: string,
  totalAmount: number,
  dateStr: string,
): string | null {
  const base = validateCommissionInput(description, totalAmount, dateStr);
  if (base) return base;
  const paid = paidAmountOf(commission);
  if (round2(Number(totalAmount)) < paid - 0.005) {
    return `El total no puede ser menor a lo ya abonado (${paid}). Anula un abono si necesitas reducirlo.`;
  }
  return null;
}

export interface CommissionEditInput {
  description: string;
  totalAmount: number;
  commissionDate: string;
  goalMonth: string;
}

/**
 * Edita una comisión ya registrada conservando su id, sus abonos y su historial
 * (los derivados se recalculan; el archivado no se altera con una edición).
 */
export function editCommission(
  commissions: Commission[],
  id: string,
  input: CommissionEditInput,
  opts?: { now?: string },
): Commission[] {
  const list = Array.isArray(commissions) ? commissions : [];
  const commissionDate = normalizeDate(input.commissionDate);
  return list.map(c => {
    if (c.id !== id) return c;
    return recalcCommission({
      ...c,
      id: c.id,
      description: String(input.description ?? "").trim(),
      totalAmount: round2(Number(input.totalAmount) || 0),
      commissionDate: commissionDate || c.commissionDate,
      goalMonth: normalizeMonth(input.goalMonth) || normalizeMonth(commissionDate) || effectiveGoalMonth(c),
      payments: paymentsOf(c),
      createdAt: c.createdAt,
      updatedAt: opts?.now ?? new Date().toISOString(),
    });
  });
}

export type CommissionDeleteMode = "deleted" | "archived" | "not-found";

export interface DeleteCommissionResult {
  commissions: Commission[];
  mode: CommissionDeleteMode;
}

/**
 * Elimina una comisión ya registrada:
 *  * sin abonos → borrado físico (mode "deleted"): no hay historial que perder.
 *  * con abonos → archivado auditado (mode "archived"): se marca deletedAt, deja
 *    de listarse y de contar para las metas, pero se conserva y es restaurable.
 */
export function deleteCommission(
  commissions: Commission[],
  id: string,
  opts?: { now?: string },
): DeleteCommissionResult {
  const list = Array.isArray(commissions) ? commissions : [];
  const target = list.find(c => c && c.id === id);
  if (!target) return { commissions: list, mode: "not-found" };
  if (paymentsOf(target).length > 0) {
    const now = opts?.now ?? new Date().toISOString();
    return {
      commissions: list.map(c => (c.id === id ? { ...c, deletedAt: now, updatedAt: now } : c)),
      mode: "archived",
    };
  }
  return { commissions: list.filter(c => c.id !== id), mode: "deleted" };
}

/** Restaura una comisión archivada: vuelve a listarse y a contar para las metas. */
export function restoreCommission(commissions: Commission[], id: string, opts?: { now?: string }): Commission[] {
  const list = Array.isArray(commissions) ? commissions : [];
  const now = opts?.now ?? new Date().toISOString();
  return list.map(c => {
    if (c.id !== id || !c.deletedAt) return c;
    const restored: Commission = { ...c, updatedAt: now };
    delete restored.deletedAt;
    return recalcCommission(restored);
  });
}

// ─── Reajustes de meta (bitácora) ────────────────────────────────────────────

export interface GoalTargetSlice {
  monthlyGoal: { target: number };
  quarterlyGoal: { target: number };
  goalAdjustments: GoalAdjustment[];
}

/**
 * Aplica un reajuste de meta del mes o del trimestre:
 *  * actualiza el valor vigente (monthlyGoal/quarterlyGoal),
 *  * y agrega un registro a la bitácora goalAdjustments (append-only).
 * Si el monto no cambia, no altera nada (idempotente).
 */
export function applyGoalTarget(
  slice: GoalTargetSlice,
  type: GoalTargetType,
  amount: number,
  dateStr: string,
  note?: string,
  opts?: { id?: string; now?: string },
): GoalTargetSlice {
  const monthly = { ...(slice.monthlyGoal ?? { target: 0 }) };
  const quarterly = { ...(slice.quarterlyGoal ?? { target: 0 }) };
  const adjustments = Array.isArray(slice.goalAdjustments) ? slice.goalAdjustments : [];
  const period = periodFor(type, dateStr);
  const to = round2(Math.max(0, Number(amount) || 0));
  const from = round2(Number(type === "monthly" ? monthly.target : quarterly.target) || 0);
  if (to === from) return { monthlyGoal: monthly, quarterlyGoal: quarterly, goalAdjustments: adjustments };
  if (type === "monthly") monthly.target = to; else quarterly.target = to;
  const entry: GoalAdjustment = {
    id: opts?.id ?? makeId("adj"),
    type,
    periodKey: period.key,
    periodStart: period.start,
    periodEnd: period.end,
    from,
    to,
    note: note?.trim() ? note.trim() : undefined,
    at: opts?.now ?? new Date().toISOString(),
  };
  return { monthlyGoal: monthly, quarterlyGoal: quarterly, goalAdjustments: [...adjustments, entry] };
}

/**
 * Monto de meta vigente durante un período histórico, según la bitácora:
 * el último reajuste del período o de uno anterior; si todos los reajustes son
 * posteriores, el valor previo (`from`) del más antiguo; si no hay bitácora, el
 * valor actual.
 */
export function targetForPeriod(
  adjustments: GoalAdjustment[],
  type: GoalTargetType,
  currentTarget: number,
  periodKey: string,
): number {
  const list = (Array.isArray(adjustments) ? adjustments : [])
    .filter(a => a && a.type === type && typeof a.periodKey === "string")
    .slice()
    .sort((a, b) => (a.periodKey === b.periodKey
      ? String(a.at ?? "").localeCompare(String(b.at ?? ""))
      : a.periodKey.localeCompare(b.periodKey)));
  const before = list.filter(a => a.periodKey <= periodKey);
  if (before.length) return round2(Number(before[before.length - 1].to) || 0);
  const after = list.find(a => a.periodKey > periodKey);
  if (after) return round2(Number(after.from) || 0);
  return round2(Number(currentTarget) || 0);
}

/** Bitácora de reajustes más reciente primero (solo del tipo indicado). */
export function adjustmentsOf(adjustments: GoalAdjustment[], type?: GoalTargetType): GoalAdjustment[] {
  return (Array.isArray(adjustments) ? adjustments : [])
    .filter(a => a && (!type || a.type === type))
    .slice()
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
}

/** Comisiones ordenadas: primero las que están en proceso, luego pendientes y liquidadas. */
export function sortCommissions(commissions: Commission[]): Commission[] {
  const rank: Record<CommissionStatus, number> = { partial: 0, pending: 1, paid: 2 };
  return (Array.isArray(commissions) ? commissions : [])
    .slice()
    .sort((a, b) => {
      const r = rank[statusOf(a)] - rank[statusOf(b)];
      if (r !== 0) return r;
      const ad = normalizeDate(a.commissionDate), bd = normalizeDate(b.commissionDate);
      if (ad !== bd) return bd.localeCompare(ad);
      return String(b.id).localeCompare(String(a.id));
    });
}

/** Totales de un período (para el resumen del dashboard y de la pestaña Metas). */
export function periodSummary(commissions: Commission[], type: GoalTargetType, dateStr: string) {
  const period = periodFor(type, dateStr);
  const inPeriod = commissionsInPeriod(commissions, period);
  return {
    period,
    total: round2(inPeriod.reduce((a, c) => a + totalOf(c), 0)),
    settled: settledTotalOf(inPeriod),
    inProcess: inProcessTotalOf(inPeriod),
    pending: round2(inPeriod.filter(c => statusOf(c) === "pending").reduce((a, c) => a + totalOf(c), 0)),
    count: inPeriod.length,
  };
}
