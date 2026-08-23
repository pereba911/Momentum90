// Edge Function: extrae información financiera de un texto con DeepSeek.
// La clave DEEPSEEK_API_KEY se lee de secrets del servidor (NUNCA del cliente).
// Requiere un usuario autenticado (Authorization: Bearer <access_token>).

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { buildMasterPrompt, parseExtraction, type UserContext } from "./prompt.ts";

const app = new Hono();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";

const authClient = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["POST", "OPTIONS"],
  maxAge: 600,
}));

async function getUser(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await authClient().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

app.post("*", async (c) => {
  try {
    console.log("[EXTRACT_AI_PATH]", c.req.method, c.req.path);
    const user = await getUser(c.req.header("authorization"));
    if (!user) {
      return c.json({ success: false, error: "No autorizado. Inicia sesión." }, 401);
    }

    if (!DEEPSEEK_API_KEY) {
      return c.json({ success: false, error: "IA no configurada en el servidor (falta DEEPSEEK_API_KEY)." }, 503);
    }

    const body = await c.req.json().catch(() => null);
    const text = String(body?.text ?? "").trim();
    const userContext = body?.userContext as UserContext | undefined;
    if (!text) return c.json({ success: false, error: "Falta el texto a procesar." }, 400);
    if (!userContext || !Array.isArray(userContext.categories)) {
      return c.json({ success: false, error: "Falta userContext válido." }, 400);
    }

    const prompt = `${buildMasterPrompt(userContext)}\n\nTEXTO TRANSCRITO DEL USUARIO:\n"${text}"`;

    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Eres un asistente que responde SOLO con JSON válido, sin markdown." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = ((await res.json()) as any)?.error?.message || detail; } catch { /* noop */ }
      return c.json({ success: false, error: `Error de DeepSeek (${detail}).` }, 502);
    }

    const data = (await res.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return c.json({ success: false, error: "La IA no devolvió contenido." }, 502);

    const extraction = parseExtraction(content);
    return c.json({ success: true, data: extraction });
  } catch (e) {
    console.error("[EXTRACT_AI_ERROR]", e);
    return c.json({ success: false, error: "Error interno al extraer con IA." }, 500);
  }
});

Deno.serve(app.fetch);
