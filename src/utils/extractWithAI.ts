// Extracción de información financiera desde texto transcrito.
// La llamada a DeepSeek ocurre en la Edge Function "extract-with-ai" (la clave
// DEEPSEEK_API_KEY vive en secrets del servidor, NUNCA en el bundle del cliente).
// Este módulo solo construye el request y parsea la respuesta.

export interface UserContext {
  categories: string[];                            // categorías conocidas (gastos/ingresos)
  activeDebts: { name: string; id: string }[];     // deudas activas
  contacts: { name: string; id: string }[];        // contactos
  businesses: { name: string; id: string }[];      // negocios
  primaryCurrency: string;                         // p. ej. "MXN"
  today: string;                                   // YYYY-MM-DD (local)
}

export type AIOperationType = "expense" | "income" | "debt_payment" | "debt_creation" | "commitment" | "asset" | "transfer" | "income_payment" | "unknown";

export interface AIOperation {
  type: AIOperationType;
  amount: number | null;
  currency: string | null;
  date: string | null;            // YYYY-MM-DD o null
  category: string | null;
  merchant_or_contact: string | null;
  notes: string | null;
  confidence: number;             // 0..1
  ambiguities: string[];
}

export interface AIExtraction {
  operations: AIOperation[];
  explanation: string;
  suggested_category: string | null;
  matched_debt: string | null;
  matched_contact: string | null;
  source?: "voice";
}

// URL de la Edge Function (mismo patrón que el resto de la app).
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
const FUNCTIONS_URL = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined) || "";
const EDGE_URL = (FUNCTIONS_URL && !FUNCTIONS_URL.includes("make-server"))
  ? `${FUNCTIONS_URL.replace(/\/$/, "")}/extract-with-ai`
  : SUPABASE_URL
    ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/extract-with-ai`
    : "";

// Llama a la Edge Function (requiere sesión autenticada) y devuelve la extracción.
export async function extractWithAI(transcribedText: string, userContext: UserContext, accessToken: string): Promise<AIExtraction> {
  const text = (transcribedText || "").trim();
  if (!text) throw new Error("El texto transcrito está vacío.");
  if (!accessToken) throw new Error("Sesión no válida. Vuelve a iniciar sesión.");
  if (!EDGE_URL) throw new Error("No se pudo determinar la URL del servicio de IA.");

  let res: Response;
  try {
    res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ text, userContext }),
    });
  } catch {
    throw new Error("No se pudo contactar al servicio de IA. Revisa tu conexión.");
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = ((await res.json()) as any)?.error || detail; } catch { /* noop */ }
    throw new Error(`Error del servicio de IA (${detail}).`);
  }

  const data = (await res.json()) as any;
  // La Edge Function responde { success: true, data: <extracción> }.
  if (data?.success === false) {
    throw new Error(typeof data.error === "string" ? data.error : "La IA no pudo extraer información.");
  }
  const extraction = data?.data;
  if (!extraction || !Array.isArray(extraction.operations)) {
    throw new Error("La IA no devolvió una extracción válida.");
  }
  return extraction as AIExtraction;
}

// Parsea el JSON devuelto por la IA tolerando fences de markdown (fallback local).
export function parseExtraction(content: string): AIExtraction {
  let raw = (content || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(raw) as Partial<AIExtraction>;
  const ops = Array.isArray(parsed.operations) ? parsed.operations : [];
  return {
    operations: ops,
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
    suggested_category: parsed?.suggested_category ?? null,
    matched_debt: parsed?.matched_debt ?? null,
    matched_contact: parsed?.matched_contact ?? null,
    source: "voice",
  };
}
