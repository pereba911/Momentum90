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

    // Deuda no reconocida (para abonos/creación de deuda)
    const debtHint = extraction.matched_debt || op.merchant_or_contact || "";
    if ((op.type === "debt_payment" || op.type === "debt_creation") && debtHint) {
      const known = ctx.activeDebts.some(d => d.name.toLowerCase() === debtHint.toLowerCase());
      if (!known) {
        warnings.push({
          field: `${label}.debt`,
          message: op.type === "debt_payment"
            ? `"${debtHint}" no coincide con tus deudas registradas (se creará una nueva deuda).`
            : `"${debtHint}" no coincide con deudas conocidas (se creará una nueva deuda).`,
        });
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
