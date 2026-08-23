// Validación inteligente de la extracción de IA antes de mostrar la bandeja de revisión.
// Reglas: montos en rango, fechas no futuras, categoría conocida, nombres reconocidos,
// confianza mínima y moneda ambigua. errors bloquean el guardado; warnings solo avisan.

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_HINTS = ["dólar", "dolares", "usd", "euro", "soles", "pesos colombianos", "colones"];

export function validateExtraction(extraction: AIExtraction | null, ctx: UserContext): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!extraction || !Array.isArray(extraction.operations) || extraction.operations.length === 0) {
    return { errors: [{ field: "operations", message: "No se detectaron operaciones para guardar." }], warnings: [], canProceed: false };
  }

  extraction.operations.forEach((op: AIOperation, i: number) => {
    const label = `Op ${i + 1}`;

    // Monto
    if (!Number.isFinite(op.amount) || op.amount <= 0) {
      errors.push({ field: `${label}.amount`, message: `Monto inválido (${op.amount}).` });
    } else if (op.amount >= MAX_AMOUNT) {
      errors.push({ field: `${label}.amount`, message: `El monto (${op.amount.toLocaleString()}) excede el límite de ${MAX_AMOUNT.toLocaleString()}.` });
    }

    // Fecha
    if (op.date && !DATE_RE.test(op.date)) {
      errors.push({ field: `${label}.date`, message: "Fecha con formato inválido (esperado YYYY-MM-DD)." });
    } else if (op.date && ctx.today && op.date > ctx.today) {
      warnings.push({ field: `${label}.date`, message: `La fecha (${op.date}) es futura; se usará hoy (${ctx.today}).` });
    }

    // Tipo soportado
    if (op.type !== "income" && op.type !== "expense" && op.type !== "debt") {
      errors.push({ field: `${label}.type`, message: `Tipo no soportado para guardar ("${op.type}").` });
    }

    // Categoría desconocida
    if (op.category && ctx.categories.length > 0 && !ctx.categories.some(c => c.toLowerCase() === op.category!.toLowerCase())) {
      warnings.push({ field: `${label}.category`, message: `La categoría "${op.category}" no existe en tu contexto (se guardará igual).` });
    }

    // Deuda no reconocida
    if (op.type === "debt" && op.matchedDebtName) {
      const known = ctx.activeDebts.some(d => d.name.toLowerCase() === op.matchedDebtName!.toLowerCase());
      if (!known) {
        warnings.push({ field: `${label}.debt`, message: `La deuda "${op.matchedDebtName}" no coincide con tus deudas registradas (se creará una nueva).` });
      }
    }

    // Contacto / negocio no reconocido
    if (op.matchedContactName) {
      const known =
        ctx.contacts.some(c => c.name.toLowerCase().includes(op.matchedContactName!.toLowerCase())) ||
        ctx.businesses.some(b => b.name.toLowerCase().includes(op.matchedContactName!.toLowerCase()));
      if (!known) {
        warnings.push({ field: `${label}.contact`, message: `"${op.matchedContactName}" no coincide con contactos/negocios conocidos.` });
      }
    }

    // Confianza baja
    if (typeof op.confidence === "number" && op.confidence < 0.7) {
      warnings.push({ field: `${label}.confidence`, message: `Confianza baja (${Math.round(op.confidence * 100)}%). Revisa el monto antes de guardar.` });
    }
  });

  // Moneda ambigua (heurística sobre la explicación)
  const text = (extraction.explanation || "").toLowerCase();
  if (ctx.primaryCurrency !== "USD" && CURRENCY_HINTS.some(h => text.includes(h))) {
    warnings.push({ field: "currency", message: `Posible moneda distinta a ${ctx.primaryCurrency}; revisa antes de guardar.` });
  }

  return { errors, warnings, canProceed: errors.length === 0 };
}
