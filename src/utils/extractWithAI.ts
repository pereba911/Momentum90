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

export type AIOperationType = "income" | "expense" | "debt";

export interface AIOperation {
  type: AIOperationType;
  amount: number;
  date: string;               // YYYY-MM-DD
  description: string;
  category?: string;
  matchedDebtName?: string;   // nombre de deuda conocida (se resuelve a id al guardar)
  matchedContactName?: string;
  confidence: number;         // 0..1
  notes?: string;
}

export interface AIExtraction {
  operations: AIOperation[];
  explanation: string;
  suggested_category?: string;
  matched_debt?: string;
  matched_contact?: string;
  source: "voice";
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
  const extraction = data?.extraction;
  if (!extraction || !Array.isArray(extraction.operations)) {
    throw new Error("La IA no devolvió una extracción válida.");
  }
  return extraction as AIExtraction;
}

// Parsea el JSON devuelto por la IA tolerando fences de markdown.
export function parseExtraction(content: string): AIExtraction {
  let raw = (content || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(raw) as Partial<AIExtraction>;
  const ops = Array.isArray(parsed.operations) ? parsed.operations : [];
  return {
    operations: ops,
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
    suggested_category: typeof parsed.suggested_category === "string" ? parsed.suggested_category : undefined,
    matched_debt: typeof parsed.matched_debt === "string" ? parsed.matched_debt : undefined,
    matched_contact: typeof parsed.matched_contact === "string" ? parsed.matched_contact : undefined,
    source: "voice",
  };
}
