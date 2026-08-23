// Validación inteligente de la extracción de IA (esquema expandido).
// errors bloquean el guardado; warnings solo avisan.

import type { AIExtraction, AIOperation, UserContext } from "./extractWithAI";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  canProceed: boolean;
}

export const MAX_AMOUNT = 1_000_000;

// Tipos que el módulo puede guardar automáticamente por voz.
export const SAVABLE_TYPES = ["expense", "income", "debt_payment", "debt_creation"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateExtraction(extraction: AIExtraction | null, ctx: UserContext): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!extraction || !Array.isArray(extraction.operations) || extraction.operations.length === 0) {
    return { errors: [{ field: "operations", message: "No se detectaron operaciones para guardar." }], warnings: [], canProceed: false };
  }

  extraction.operations.forEach((op: AIOperation, i: number) => {
    const label = `Op ${i + 1}`;

    // Tipo soportado para guardado automático
    if (!SAVABLE_TYPES.includes(op.type as any)) {
      errors.push({
        field: `${label}.type`,
        message: `El tipo "${op.type}" aún no se puede guardar automáticamente por voz. Regístralo manualmente.`,
      });
    }

    // Monto
    if (op.amount == null) {
      errors.push({ field: `${label}.amount`, message: "Falta el monto." });
    } else if (!Number.isFinite(op.amount) || op.amount <= 0) {
      errors.push({ field: `${label}.amount`, message: `Monto inválido (${op.amount}).` });
    } else if (op.amount >= MAX_AMOUNT) {
      errors.push({ field: `${label}.amount`, message: `El monto (${op.amount.toLocaleString()}) excede el límite de ${MAX_AMOUNT.toLocaleString()}.` });
    }

    // Fecha
    if (op.date == null) {
      warnings.push({ field: `${label}.date`, message: "Fecha no especificada; se usará hoy." });
    } else if (!DATE_RE.test(op.date)) {
      errors.push({ field: `${label}.date`, message: "Fecha con formato inválido (esperado YYYY-MM-DD)." });
    } else if (ctx.today && op.date > ctx.today) {
      warnings.push({ field: `${label}.date`, message: `La fecha (${op.date}) es futura; se usará hoy (${ctx.today}).` });
    }

    // Moneda
    if (op.currency == null) {
      warnings.push({ field: `${label}.currency`, message: `Moneda no especificada; se asume ${ctx.primaryCurrency}.` });
    } else if (op.currency !== ctx.primaryCurrency) {
      warnings.push({ field: `${label}.currency`, message: `La moneda detectada (${op.currency}) difiere de tu moneda (${ctx.primaryCurrency}).` });
    }

    // Categoría desconocida
    if (op.category && ctx.categories.length > 0 && !ctx.categories.some(c => c.toLowerCase() === op.category!.toLowerCase())) {
      warnings.push({ field: `${label}.category`, message: `La categoría "${op.category}" no existe en tu contexto (se guardará igual).` });
    }

    // Abono de deuda: exige una deuda ÚNICA identificada (nunca elegir una errónea).
    if (op.type === "debt_payment") {
      const hint = extraction.matched_debt || op.merchant_or_contact || "";
      const matches = hint ? ctx.activeDebts.filter(d => d.name.toLowerCase() === hint.toLowerCase()) : [];
      if (matches.length === 0) {
        errors.push({ field: `${label}.debt`, message: "No se identificó una deuda única para el abono. Selecciona o crea la deuda antes." });
      } else if (matches.length > 1) {
        errors.push({ field: `${label}.debt`, message: `Hay ${matches.length} deudas que coinciden con "${hint}". Sé más específico.` });
      }
    } else if (op.type === "debt_creation" && (extraction.matched_debt || op.merchant_or_contact)) {
      const hint = extraction.matched_debt || op.merchant_or_contact || "";
      if (!ctx.activeDebts.some(d => d.name.toLowerCase() === hint.toLowerCase())) {
        warnings.push({ field: `${label}.debt`, message: `"${hint}" no coincide con deudas conocidas (se creará una nueva deuda).` });
      }
    }

    // Contacto / negocio no reconocido
    const contactHint = extraction.matched_contact || op.merchant_or_contact || "";
    if (contactHint && op.type !== "debt_payment" && op.type !== "debt_creation") {
      const known =
        ctx.contacts.some(c => c.name.toLowerCase().includes(contactHint.toLowerCase())) ||
        ctx.businesses.some(b => b.name.toLowerCase().includes(contactHint.toLowerCase()));
      if (!known) {
        warnings.push({ field: `${label}.contact`, message: `"${contactHint}" no coincide con contactos/negocios conocidos.` });
      }
    }

    // Confianza baja
    if (typeof op.confidence === "number" && op.confidence < 0.7) {
      warnings.push({ field: `${label}.confidence`, message: `Confianza baja (${Math.round(op.confidence * 100)}%). Revisa el monto.` });
    }

    // Ambigüedades marcadas por la IA
    if (Array.isArray(op.ambiguities) && op.ambiguities.length > 0) {
      op.ambiguities.forEach(a => warnings.push({ field: `${label}.ambiguities`, message: String(a) }));
    }
  });

  return { errors, warnings, canProceed: errors.length === 0 };
}

// Efecto esperado sobre el efectivo disponible de una propuesta de IA (bandeja).
export function aiOpCashEffect(op: AIOperation, ctx: UserContext): { label: string; direction: "in" | "out" | "none"; amount: number; cls: string } {
  const amt = op.amount ?? 0;
  const fmtA = (n: number) => `${n.toLocaleString("es-MX")} ${ctx.primaryCurrency}`;
  switch (op.type) {
    case "income":
      return { label: `Efecto esperado: +${fmtA(amt)} al efectivo`, direction: "in", amount: amt, cls: "text-emerald-400" };
    case "expense":
      return { label: `Efecto esperado: −${fmtA(amt)} al efectivo`, direction: "out", amount: amt, cls: "text-red-400" };
    case "debt_payment":
      return { label: `Efecto esperado: −${fmtA(amt)} al efectivo (y reduce la deuda)`, direction: "out", amount: amt, cls: "text-red-400" };
    case "debt_creation":
      return { label: "Sin efecto inmediato: se crea una deuda (no mueve efectivo)", direction: "none", amount: 0, cls: "text-gray-400" };
    case "commitment":
      return { label: "Sin efecto inmediato: compromiso futuro (proyección pendiente)", direction: "none", amount: 0, cls: "text-sky-400" };
    case "asset":
      return { label: "Sin efecto inmediato: activo (requiere confirmar si salió de efectivo)", direction: "none", amount: 0, cls: "text-violet-400" };
    case "transfer":
      return { label: "Sin efecto inmediato: transferencia (requiere origen/destino)", direction: "none", amount: 0, cls: "text-cyan-400" };
    case "income_payment":
      return { label: "Sin efecto inmediato: cobro de ingreso por cobrar (por confirmar)", direction: "none", amount: 0, cls: "text-emerald-400" };
    case "unknown":
    default:
      return { label: "Sin efecto: mensaje sin información financiera", direction: "none", amount: 0, cls: "text-gray-400" };
  }
}
