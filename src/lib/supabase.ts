import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// La app SOLO usa variables de entorno para conectar con Supabase.
// NO hay keys hardcodeadas aquí: el fallback anterior a un proyecto viejo era
// la causa del error "Invalid API key".
//
// IMPORTANTE: NO lanzamos un error a nivel de módulo. Si faltan las variables,
// la app muestra una pantalla de configuración en vez de quedarse en negro
// (un throw en el import rompía el arranque de React).
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// DIAGNÓSTICO TEMPORAL — confirma qué variables llegan en producción (sin exponer la key)
console.log("[ENV] SUPABASE_CONFIGURED=", SUPABASE_CONFIGURED, "| URL=", SUPABASE_URL ? "set" : "MISSING", "| ANON=", SUPABASE_ANON_KEY ? "set" : "MISSING");

export const API_BASE = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/make-server-da3143e6` : "");
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "octaface@gmail.com";
export const PRICE_USD = "$14.99";
export const STRIPE_PAYMENT_LINK = ""; // Set your Stripe payment link here

export const supabase: SupabaseClient = SUPABASE_CONFIGURED
  ? createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "m90_session" },
    })
  : (null as unknown as SupabaseClient); // Solo se usa cuando SUPABASE_CONFIGURED es true

export interface UserProfile {
  id: string; email: string;
  role: "admin" | "user";
  trial_start?: string | null;
  trial_end?: string | null;
  trial_days?: number;
  subscription_status: "active" | "trial" | "expired";
  subscription_expires_at: string | null;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  created_at: string;
}

export interface UserSettings {
  currency: string;
  darkMode: boolean;
  language: "es" | "en";
  fundLabels: { emergency: string; investment: string; custom: string };
  stripeUrl: string;
}

export type AppEntityName =
  | "incomes"
  | "expenses"
  | "recurringExpenses"
  | "debts"
  | "goals"
  | "tasks"
  | "businesses"
  | "contacts"
  | "planWeeks"
  | "habitLogs"
  | "miniVictories"
  | "quarterHistory"
  | "assets";

export type AssetType = "cash" | "bank" | "investment" | "property" | "business" | "vehicle" | "receivable" | "other";

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  value: number;      // pesos enteros (MXN)
  updatedAt: string;  // fecha de actualización (YYYY-MM-DD)
  notes?: string;
  createdAt: string;
}

export interface IntegrationConfig {
  id: string;             // 'stripe', 'whatsapp', ...
  enabled: boolean;
  status: string;         // 'connected' | 'disconnected' | 'error'
  config: Record<string, unknown>; // solo datos públicos
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

export interface EntityPayload<T> {
  entity: AppEntityName;
  items: T[];
  updatedAt?: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  currency: "MXN",
  darkMode: true,
  language: "es",
  fundLabels: { emergency: "Fondo de Emergencia", investment: "Capital de Inversión", custom: "Fondo Personal" },
  stripeUrl: STRIPE_PAYMENT_LINK,
};

// ─── API helpers ──────────────────────────────────────────────────────────────
// DIAGNÓSTICO TEMPORAL: registra cada llamada al edge function (URL, método, status y error).
async function apiCall(token: string, method: string, path: string, body?: unknown) {
  const url = `${API_BASE}${path}`;
  console.log(`[API_CALL] ${method} ${path} → ${url}`);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[API_ERROR] ${method} ${path} → HTTP ${res.status} ${res.statusText}\n${text}`);
      throw new Error(`API ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    }
    console.log(`[API_OK] ${method} ${path} → HTTP ${res.status}`);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.error(`[API_EXCEPTION] ${method} ${path}`, e);
    throw e;
  }
}

export const api = {
  getProfile: (t: string) => apiCall(t, "GET", "/profile"),
  getData: (t: string) => apiCall(t, "GET", "/data"),
  saveData: (t: string, data: unknown) => apiCall(t, "POST", "/data", { data }),
  getEntity: <T = unknown>(t: string, entity: AppEntityName) => apiCall<T>(t, "GET", `/entities/${entity}`),
  saveEntity: <T = unknown>(t: string, entity: AppEntityName, items: T[]) => apiCall(t, "POST", `/entities/${entity}`, { entity, items }),
  getSettings: (t: string) => apiCall(t, "GET", "/settings"),
  saveSettings: (t: string, settings: UserSettings) => apiCall(t, "POST", "/settings", { settings }),
  getUsers: (t: string) => apiCall(t, "GET", "/users"),
  updateUser: (t: string, userId: string, updates: Partial<UserProfile>) => apiCall(t, "PUT", `/profile/${userId}`, updates),
  adminCreateUser: (t: string, payload: { email: string; password: string; trialDays: number; role?: "admin" | "user" }) => apiCall(t, "POST", "/admin/users", payload),
  adminListIntegrations: (t: string) => apiCall(t, "GET", "/admin/integrations"),
  adminSaveIntegration: (t: string, integration: { id: string; enabled: boolean; status: string; config: Record<string, unknown> }) => apiCall(t, "PUT", "/admin/integrations", integration),
  adminListSubscriptions: (t: string) => apiCall(t, "GET", "/admin/subscriptions"),
  createStripeCheckout: (t: string) => apiCall(t, "POST", "/stripe/checkout"),
  requestPasswordReset: (email: string) => supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/reset` }),
};

export function getAccessToken(session: { access_token?: string } | null): string | undefined {
  return session?.access_token;
}

export function getDaysLeft(profile: UserProfile | null): number {
  if (!profile || profile.role === "admin" || profile.subscription_status === "active") return Infinity;
  if (!profile.subscription_expires_at) return 0;
  const diff = new Date(profile.subscription_expires_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

export function canAccess(profile: UserProfile | null): boolean {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  if (profile.subscription_status === "active") return true;
  if (profile.subscription_status === "trial" && getDaysLeft(profile) > 0) return true;
  return false;
}
