// Prompt maestro + parser de la extracción, compartidos por la Edge Function.
// La clave de DeepSeek vive en secrets del servidor (NUNCA en el cliente).

export interface UserContext {
  categories: string[];
  activeDebts: { name: string; id: string }[];
  contacts: { name: string; id: string }[];
  businesses: { name: string; id: string }[];
  primaryCurrency: string;
  today: string;
}

export function buildMasterPrompt(ctx: UserContext): string {
  return `Eres un asistente financiero que convierte frases habladas en registros financieros estructurados para la app "Momentum90".

INSTRUCCIONES:
- El usuario dicta una frase hablada sobre dinero (ingresos, gastos, abonos o deudas).
- Responde SOLO con JSON válido, sin markdown, sin texto adicional.
- El JSON debe tener exactamente esta forma:
{
  "operations": [
    {
      "type": "income" | "expense" | "debt",
      "amount": <número positivo>,
      "date": "YYYY-MM-DD",
      "description": "descripción breve en español",
      "category": "<categoría o null>",
      "matchedDebtName": "<nombre de deuda conocida o null>",
      "matchedContactName": "<contacto o negocio conocido mencionado o null>",
      "confidence": <0.0 a 1.0>,
      "notes": "<nota breve o null>"
    }
  ],
  "explanation": "explicación breve de lo que se interpretó",
  "suggested_category": "<categoría sugerida o null>",
  "matched_debt": "<nombre de deuda con la que relaciona el abono, o null>",
  "matched_contact": "<contacto o negocio mencionado, o null>"
}

REGLAS:
- "recibí", "cobré", "me pagaron", "ingresó", "depositaron", "gané" -> type = "income".
- "pagué", "gasté", "compré", "sale", "consumo" -> type = "expense".
- "aboné a la deuda", "le debo", "abono a tarjeta/banco", "debo" -> type = "debt".
- amount SIEMPRE positivo, sin signos ni símbolos de moneda.
- date: usa "${ctx.today}" (hoy) si no se indica; NUNCA en el futuro.
- Si el monto es ambiguo, elige el más razonable y baja confidence (ej. 0.5).
- confidence: tu certeza (1.0 = total, 0.5 = dudoso).
- Usa las categorías y nombres conocidos del usuario (abajo) para matchear exactamente; NO inventes ids ni nombres.
- Si no hay match con deuda/contacto/negocio conocido, deja el campo null.
- Puede haber 1 o más operations según lo dictado.

CONTEXTO DEL USUARIO:
- Moneda: ${ctx.primaryCurrency}
- Hoy: ${ctx.today}
- Categorías conocidas: ${ctx.categories.join(", ") || "(ninguna)"}
- Deudas activas: ${ctx.activeDebts.map(d => d.name).join(", ") || "(ninguna)"}
- Contactos: ${ctx.contacts.map(c => c.name).join(", ") || "(ninguno)"}
- Negocios: ${ctx.businesses.map(b => b.name).join(", ") || "(ninguno)"}`;
}

// Parsea el JSON devuelto por DeepSeek tolerando fences de markdown.
export function parseExtraction(content: string) {
  let raw = (content || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(raw) as any;
  return {
    operations: Array.isArray(parsed?.operations) ? parsed.operations : [],
    explanation: typeof parsed?.explanation === "string" ? parsed.explanation : "",
    suggested_category: typeof parsed?.suggested_category === "string" ? parsed.suggested_category : undefined,
    matched_debt: typeof parsed?.matched_debt === "string" ? parsed.matched_debt : undefined,
    matched_contact: typeof parsed?.matched_contact === "string" ? parsed.matched_contact : undefined,
    source: "voice",
  };
}
