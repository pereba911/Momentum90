import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "octaface@gmail.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Stripe es opcional: si faltan credenciales, checkout/webhook quedan desactivados
// en vez de tumbar el arranque del edge function.
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const authClient = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const adminClient = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

async function getUser(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await authClient().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

function makeDefaultProfile(user: any) {
  const isAdmin = String(user.email ?? "").toLowerCase() === String(ADMIN_EMAIL).toLowerCase();
  return {
    id: user.id,
    email: user.email,
    role: isAdmin ? "admin" : "user",
    currency: "MXN",
    subscription_status: isAdmin ? "active" : "trial",
    subscription_expires_at: isAdmin ? null : new Date(Date.now() + 14 * 86400000).toISOString(),
    stripe_customer_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function ensureProfile(user: { id: string; email?: string | null }) {
  const supabase = adminClient();
  const { data: existing, error: selectError } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (selectError) throw new Error(selectError.message);

  if (existing) {
    return existing;
  }

  const profile = makeDefaultProfile(user);
  const { error: insertError } = await supabase.from("user_profiles").insert(profile);
  if (insertError) throw new Error(insertError.message);

  // Mantener sincronizada la tabla de roles (idempotente, best-effort).
  const { error: rolesError } = await supabase.from("user_roles").upsert({
    user_id: user.id,
    role: profile.role,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (rolesError) console.warn("user_roles sync skipped:", rolesError.message);

  return profile;
}

async function ensureRoles(user: { id: string; role: string }) {
  const supabase = adminClient();
  const { error } = await supabase.from("user_roles").upsert({
    user_id: user.id,
    role: user.role,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) console.warn("user_roles sync skipped:", error.message);
}

// Audit log: best-effort. Si la tabla no existe aún, no bloquea la operación.
async function writeAudit(userId: string, action: string, entity?: string, entityId?: string, payload?: unknown) {
  const { error } = await adminClient().from("audit_log").insert({
    user_id: userId,
    action,
    entity,
    entity_id: entityId,
    payload: payload ?? {},
  });
  if (error) console.warn("audit_log write skipped:", error.message);
}

async function ensureSettings(userId: string) {
  const supabase = adminClient();
  const { data: existing, error } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (existing?.settings) return existing.settings;

  const defaultSettings = {
    currency: "MXN",
    darkMode: true,
    language: "es",
    fundLabels: {
      emergency: "Fondo de Emergencia",
      investment: "Capital de Inversión",
      custom: "Fondo Personal",
    },
    stripeUrl: "",
  };

  const { error: upsertError } = await supabase.from("user_settings").upsert({
    user_id: userId,
    settings: defaultSettings,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (upsertError) throw new Error(upsertError.message);
  return defaultSettings;
}

async function syncProfileAccess(profile: any) {
  const now = new Date();
  const trialEnd = profile.trial_end ? new Date(profile.trial_end) : null;
  const isAdmin = String(profile.email ?? "").toLowerCase() === String(ADMIN_EMAIL).toLowerCase();
  const nextStatus = isAdmin
    ? "active"
    : profile.subscription_status === "active"
      ? "active"
      : trialEnd && trialEnd.getTime() > now.getTime()
        ? "trial"
        : "expired";

  const todayIso = new Date().toISOString();
  const { error } = await adminClient().from("user_profiles").update({
    subscription_status: nextStatus,
    subscription_expires_at: nextStatus === "active" ? profile.subscription_expires_at ?? null : null,
    updated_at: todayIso,
  }).eq("id", profile.id);

  if (error) throw new Error(error.message);
  return { ...profile, subscription_status: nextStatus };
}

async function createStripeCustomer(email: string, userId: string) {
  const response = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ email, metadata: JSON.stringify({ user_id: userId }) }).toString(),
  });

  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message ?? "stripe customer error");
  return json.id as string;
}

// ── Helpers seguros de administración (solo servidor) ─────────────────────────
// Estas funciones NUNCA exponen service role al frontend: el cliente solo puede
// llamar a las rutas /admin/* con su JWT; aquí se valida rol admin en servidor.

async function requireAdmin(authHeader: string | undefined) {
  const user = await getUser(authHeader);
  if (!user) return { error: { status: 401, body: { error: "Unauthorized" } } };
  const profile = await ensureProfile(user);
  if (profile.role !== "admin") return { error: { status: 403, body: { error: "Forbidden" } } };
  return { user, profile };
}

async function getProfileById(id: string) {
  const { data, error } = await adminClient()
    .from("user_profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

function pickAccess(p: any) {
  return {
    role: p?.role ?? null,
    access_status: p?.access_status ?? null,
    subscription_status: p?.subscription_status ?? null,
    trial_start: p?.trial_start ?? null,
    trial_end: p?.trial_end ?? null,
    trial_days: p?.trial_days ?? null,
    subscription_expires_at: p?.subscription_expires_at ?? null,
    suspended_at: p?.suspended_at ?? null,
    suspension_reason: p?.suspension_reason ?? null,
  };
}

// Auditoría administrativa (nueva tabla admin_audit_log, solo service role).
async function writeAdminAudit(
  adminId: string,
  targetId: string | null,
  action: string,
  before: unknown,
  after: unknown,
  reason?: string
) {
  const { error } = await adminClient().from("admin_audit_log").insert({
    admin_user_id: adminId,
    target_user_id: targetId,
    action,
    before_state: before ?? null,
    after_state: after ?? null,
    reason: reason ?? null,
  });
  if (error) console.warn("admin_audit_log write skipped:", error.message);
}

// Tablas con columna user_id que pueden contener dependencias de un usuario.
const USER_DATA_TABLES = [
  "user_settings", "user_entities", "app_data", "integrations", "subscriptions",
  "incomes", "expenses", "recurring_expenses", "debts", "goals", "tasks",
  "task_completions", "assets", "deals", "pipelines", "goal_contributions",
  "achievements", "quarterly_progress", "annual_progress",
  "financial_accounts", "financial_transactions", "financial_allocations",
] as const;

async function countUserData(userId: string) {
  const counts: Record<string, number> = {};
  for (const table of USER_DATA_TABLES) {
    const { count, error } = await adminClient()
      .from(table)
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) { counts[table] = -1; continue; }
    counts[table] = count ?? 0;
  }
  return counts;
}

// Borrado por usuario (NUNCA masivo): elimina dependencias del user_id objetivo.
// user_roles y user_profiles se borran aquí explícitamente; el Auth user se borra
// al final (admin.deleteUser), cuyos CASCADE limpian identities/sessions/mfa.
async function deleteUserData(userId: string) {
  for (const table of USER_DATA_TABLES) {
    const { error } = await adminClient().from(table).delete().eq("user_id", userId);
    if (error) console.warn(`delete ${table} skipped:`, error.message);
  }
  const { error: rolesErr } = await adminClient().from("user_roles").delete().eq("user_id", userId);
  if (rolesErr) console.warn("delete user_roles skipped:", rolesErr.message);
  const { error: profErr } = await adminClient().from("user_profiles").delete().eq("id", userId);
  if (profErr) console.warn("delete user_profiles skipped:", profErr.message);
  // Referencias de auditoría previas apuntando al usuario (huérfanas).
  const { error: audErr } = await adminClient()
    .from("audit_log")
    .delete()
    .or(`user_id.eq.${userId},entity_id.eq.${userId}`);
  if (audErr) console.warn("delete audit refs skipped:", audErr.message);
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/make-server-da3143e6/health", (c) => c.json({ status: "ok" }));

// ── Profile ───────────────────────────────────────────────────────────────────
app.get("/make-server-da3143e6/profile", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let profile = await ensureProfile(user);
  const isAdmin = String(user.email ?? "").toLowerCase() === String(ADMIN_EMAIL).toLowerCase();
  if (isAdmin && profile.role !== "admin") {
    const { error } = await adminClient()
      .from("user_profiles")
      .update({
        role: "admin",
        subscription_status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (error) throw new Error(error.message);
    profile = { ...profile, role: "admin", subscription_status: "active", updated_at: new Date().toISOString() };
  }

  return c.json({ profile });
});

app.put("/make-server-da3143e6/profile/:userId", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const myProfile = await ensureProfile(user);
  if (myProfile.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const userId = c.req.param("userId");
  const updates = await c.req.json();
  const { data: profile, error } = await adminClient()
    .from("user_profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile) return c.json({ error: "Not found" }, 404);
  return c.json({ profile });
});

// ── App Data ──────────────────────────────────────────────────────────────────
app.get("/make-server-da3143e6/data", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { data, error } = await adminClient()
    .from("app_data")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return c.json({ data: data?.data ?? null });
});

app.post("/make-server-da3143e6/data", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { data } = await c.req.json();
  const { error } = await adminClient().from("app_data").upsert({
    user_id: user.id,
    data,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  return c.json({ success: true });
});

app.get("/make-server-da3143e6/entities/:entity", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const entity = c.req.param("entity");
  const { data, error } = await adminClient()
    .from("user_entities")
    .select("items")
    .eq("user_id", user.id)
    .eq("entity", entity)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return c.json({ items: Array.isArray(data?.items) ? data.items : [] });
});

app.post("/make-server-da3143e6/entities/:entity", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const entity = c.req.param("entity");
  const { entity: entityName, items } = await c.req.json();
  const normalizedItems = Array.isArray(items) ? items : [];
  const { error } = await adminClient().from("user_entities").upsert({
    user_id: user.id,
    entity: entityName ?? entity,
    items: normalizedItems,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,entity" });

  if (error) throw new Error(error.message);
  return c.json({ success: true, items: normalizedItems });
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get("/make-server-da3143e6/settings", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const settings = await ensureSettings(user.id);
  return c.json({ settings });
});

app.post("/make-server-da3143e6/settings", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { settings } = await c.req.json();
  const { error } = await adminClient().from("user_settings").upsert({
    user_id: user.id,
    settings,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  return c.json({ success: true });
});

// ── Admin: users list ─────────────────────────────────────────────────────────
app.post("/make-server-da3143e6/admin/users", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const myProfile = await ensureProfile(user);
  if (myProfile.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const { email, password, trialDays = 14, role = "user" } = await c.req.json();
  if (!email || !password) return c.json({ error: "Email and password are required" }, 400);
  const normalizedEmail = String(email).trim().toLowerCase();
  const days = Math.max(1, Number(trialDays));
  const now = new Date();
  const trialEnd = new Date(now.getTime() + days * 86400000);

  // Idempotencia: si el usuario ya existe, NO duplicamos la cuenta;
  // solo actualizamos su trial de forma segura. Búsqueda PAGINADA por email
  // con admin.listUsers (compatible con la versión de supabase-js del edge runtime).
  let existingUser: { id: string; email?: string | null } | null = null;
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data: pageData, error: listError } = await adminClient().auth.admin.listUsers({ page, perPage });
    if (listError) throw new Error(listError.message);
    const users = pageData?.users ?? [];
    const found = users.find((u: any) => String(u.email ?? "").trim().toLowerCase() === normalizedEmail);
    if (found) { existingUser = { id: found.id, email: found.email }; break; }
    if (users.length < perPage) break; // última página alcanzada
  }

  if (existingUser) {
    const existingId = existingUser.id;
    const profile = makeDefaultProfile({ id: existingId, email: normalizedEmail });
    const { error: upsertError } = await adminClient().from("user_profiles").upsert({
      ...profile,
      role,
      trial_start: now.toISOString(),
      trial_end: trialEnd.toISOString(),
      trial_days: days,
      subscription_status: "trial",
      subscription_expires_at: trialEnd.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: "id" });
    if (upsertError) throw new Error(upsertError.message);
    await ensureRoles({ id: existingId, role });
    await writeAudit(user.id, "admin.user.trial_updated", "user_profiles", existingId, { email: normalizedEmail, trialDays: days });
    return c.json({ success: true, userId: existingId, trialDays: days, alreadyExisted: true });
  }

  const { data: createdUser, error: createError } = await adminClient().auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { role },
  });

  if (createError) throw new Error(createError.message);

  const profile = makeDefaultProfile({ id: createdUser.user.id, email: normalizedEmail });
  const { error: upsertError } = await adminClient().from("user_profiles").upsert({
    ...profile,
    role,
    trial_start: now.toISOString(),
    trial_end: trialEnd.toISOString(),
    trial_days: days,
    subscription_status: "trial",
    subscription_expires_at: trialEnd.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: "id" });

  if (upsertError) throw new Error(upsertError.message);
  await ensureRoles({ id: createdUser.user.id, role });
  await writeAudit(user.id, "admin.user.created", "user_profiles", createdUser.user.id, { email: normalizedEmail, trialDays: days });
  return c.json({ success: true, userId: createdUser.user.id, trialDays: days });
});

// ── Admin: integraciones (Stripe y futuras) ──────────────────────────────────
app.get("/make-server-da3143e6/admin/integrations", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const myProfile = await ensureProfile(user);
  if (myProfile.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const { data, error } = await adminClient()
    .from("integrations")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return c.json({ integrations: data ?? [] });
});

app.put("/make-server-da3143e6/admin/integrations", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const myProfile = await ensureProfile(user);
  if (myProfile.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json();
  const id = String(body?.id ?? "").trim();
  if (!id) return c.json({ error: "Integration id is required" }, 400);

  // `user_id` se fuerza al admin; los secretos NUNCA deben enviarse desde el
  // frontend. `config` solo guarda datos públicos (ids, flags, urls).
  const safe = {
    enabled: Boolean(body.enabled),
    config: (body.config && typeof body.config === "object") ? body.config : {},
    status: String(body.status ?? "disconnected").slice(0, 40),
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminClient().from("integrations").upsert({
    id,
    user_id: user.id,
    ...safe,
  }, { onConflict: "id,user_id" });

  if (error) throw new Error(error.message);
  await writeAudit(user.id, "admin.integration.updated", "integrations", id, { enabled: safe.enabled });
  return c.json({ success: true, id });
});

// ── Admin: suscripciones ─────────────────────────────────────────────────────
app.get("/make-server-da3143e6/admin/subscriptions", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const myProfile = await ensureProfile(user);
  if (myProfile.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const { data, error } = await adminClient()
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return c.json({ subscriptions: data ?? [] });
});

app.post("/make-server-da3143e6/stripe/checkout", async (c) => {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return c.json({ error: "Stripe no está configurado aún (faltan credenciales en Edge secrets)." }, 503);
  }

  const profile = await ensureProfile(user);
  let customerId = profile.stripe_customer_id;
  if (!customerId) {
    customerId = await createStripeCustomer(user.email!, user.id);
    await adminClient().from("user_profiles").update({
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    }).eq("id", user.id);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      customer: customerId,
      line_items: JSON.stringify([{ price: STRIPE_PRICE_ID, quantity: 1 }]),
      mode: "subscription",
      success_url: `${Deno.env.get("APP_URL") ?? "http://localhost:5173"}/?checkout=success`,
      cancel_url: `${Deno.env.get("APP_URL") ?? "http://localhost:5173"}/?checkout=cancel`,
      metadata: JSON.stringify({ user_id: user.id }),
    }).toString(),
  });

  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message ?? "stripe checkout error");
  return c.json({ checkoutUrl: json.url });
});

app.post("/make-server-da3143e6/stripe/webhook", async (c) => {
  const body = await c.req.raw.arrayBuffer();
  const signature = c.req.header("stripe-signature");
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: "Stripe webhook no configurado (faltan secretos en Edge)." }, 503);
  }
  const Stripe = (await import("npm:stripe")).default;
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" as any });
  const event = stripe.webhooks.constructEvent(new Uint8Array(body), signature ?? "", STRIPE_WEBHOOK_SECRET);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;
      const status = subscription.status === "active" ? "active" : subscription.status === "trialing" ? "trial" : "expired";
      const { error } = await adminClient().from("user_profiles").update({
        stripe_subscription_id: subscription.id,
        subscription_status: status,
        subscription_expires_at: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("stripe_customer_id", customerId);
      if (error) throw new Error(error.message);

      // Espejo en la tabla de suscripciones (para el dashboard admin).
      try {
        const { data: prof } = await adminClient().from("user_profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
        if (prof?.id) {
          const subData = {
            user_id: prof.id,
            provider: "stripe",
            plan_id: subscription.items?.data?.[0]?.price?.id ?? null,
            billing_interval: subscription.items?.data?.[0]?.price?.recurring?.interval ?? null,
            status,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          };
          const { data: existingSub } = await adminClient().from("subscriptions").select("id").eq("stripe_subscription_id", subscription.id).maybeSingle();
          if (existingSub?.id) {
            await adminClient().from("subscriptions").update(subData).eq("id", existingSub.id);
          } else {
            await adminClient().from("subscriptions").insert(subData);
          }
        }
      } catch (e: any) {
        console.warn("subscriptions mirror skipped:", e.message);
      }
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as any;
      const customerId = invoice.customer as string;
      const status = event.type === "invoice.paid" ? "active" : "expired";
      const { error } = await adminClient().from("user_profiles").update({
        subscription_status: status,
        updated_at: new Date().toISOString(),
      }).eq("stripe_customer_id", customerId);
      if (error) throw new Error(error.message);
      break;
    }
    default:
      break;
  }

  return c.json({ received: true });
});

app.get("/make-server-da3143e6/users", async (c) => {
  const auth = await requireAdmin(c.req.header("Authorization"));
  if (auth.error) return c.json(auth.error.body, auth.error.status);

  const q = String(c.req.query("search") ?? "").trim().toLowerCase();
  const { data: profiles, error } = await adminClient()
    .from("user_profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Conteos de datos por usuario (sin exponer datos financieros sensibles).
  const { data: entities } = await adminClient().from("user_entities").select("user_id");
  const { data: appData } = await adminClient().from("app_data").select("user_id");
  const { data: settings } = await adminClient().from("user_settings").select("user_id");
  const countBy = (rows: any[] | null, key: string) => {
    const m: Record<string, number> = {};
    (rows ?? []).forEach((r) => { m[r[key]] = (m[r[key]] ?? 0) + 1; });
    return m;
  };
  const entityCount = countBy(entities, "user_id");
  const appDataCount = countBy(appData, "user_id");
  const settingsCount = countBy(settings, "user_id");

  // Fechas de auth (created_at / last_sign_in_at).
  const authByEmail: Record<string, any> = {};
  for (let page = 1; page <= 50; page++) {
    const { data: pageData, error: listError } = await adminClient().auth.admin.listUsers({ page, perPage: 200 });
    if (listError) break;
    const users = pageData?.users ?? [];
    users.forEach((u: any) => { authByEmail[String(u.email ?? "").toLowerCase()] = u; });
    if (users.length < 200) break;
  }

  const users = (profiles ?? [])
    .map((p: any) => {
      const au = authByEmail[String(p.email ?? "").toLowerCase()];
      return {
        ...p,
        authCreatedAt: au?.created_at ?? null,
        lastSignInAt: au?.last_sign_in_at ?? null,
        dataSummary: {
          entities: entityCount[p.id] ?? 0,
          appData: appDataCount[p.id] ?? 0,
          settings: settingsCount[p.id] ?? 0,
        },
      };
    })
    .filter((p: any) => !q || String(p.email ?? "").toLowerCase().includes(q));

  return c.json({ users });
});

// ── Admin: asignar/editar trial (fecha exacta o duración rápida) ──────────────
app.post("/make-server-da3143e6/admin/trial", async (c) => {
  const auth = await requireAdmin(c.req.header("Authorization"));
  if (auth.error) return c.json(auth.error.body, auth.error.status);
  const admin = auth.profile;

  const body = await c.req.json();
  const targetId = String(body?.userId ?? "").trim();
  if (!targetId) return c.json({ error: "userId es requerido" }, 400);

  const target = await getProfileById(targetId);
  if (!target) return c.json({ error: "Usuario no encontrado" }, 404);
  if (target.role === "admin") return c.json({ error: "No se modifican trials de admins" }, 400);

  let trialEnd: Date;
  if (body?.trialEnd) {
    const d = new Date(String(body.trialEnd));
    if (isNaN(d.getTime())) return c.json({ error: "Fecha de fin de trial inválida" }, 400);
    trialEnd = d;
  } else {
    const days = Math.max(1, Number(body?.trialDays ?? 14));
    trialEnd = new Date(Date.now() + days * 86400000);
  }

  const days = body?.trialDays ? Math.max(1, Number(body.trialDays)) : Math.max(1, Math.round((trialEnd.getTime() - Date.now()) / 86400000));
  const nowIso = new Date().toISOString();
  const oldEnd = target.trial_end ? new Date(target.trial_end) : null;
  const action = !target.trial_end
    ? "trial_created"
    : trialEnd.getTime() > oldEnd!.getTime() ? "trial_extended" : "trial_shortened";

  const before = pickAccess(target);
  const { error } = await adminClient().from("user_profiles").update({
    trial_start: target.trial_start ?? nowIso,
    trial_end: trialEnd.toISOString(),
    trial_days: days,
    subscription_status: "trial",
    subscription_expires_at: trialEnd.toISOString(),
    access_status: "trial",
    suspended_at: null,
    suspension_reason: null,
    access_updated_at: nowIso,
    access_updated_by: admin.id,
    updated_at: nowIso,
  }).eq("id", targetId);
  if (error) throw new Error(error.message);

  const after = { ...before, trial_end: trialEnd.toISOString(), trial_days: days, access_status: "trial" };
  await writeAdminAudit(admin.id, targetId, action, before, after, body?.reason);
  return c.json({ success: true, action, trialEnd: trialEnd.toISOString(), trialDays: days });
});

// ── Admin: activar / suspender / revocar acceso ───────────────────────────────
app.post("/make-server-da3143e6/admin/access/activate", async (c) => {
  const auth = await requireAdmin(c.req.header("Authorization"));
  if (auth.error) return c.json(auth.error.body, auth.error.status);
  const admin = auth.profile;
  const body = await c.req.json();
  const targetId = String(body?.userId ?? "").trim();
  if (!targetId) return c.json({ error: "userId es requerido" }, 400);
  const target = await getProfileById(targetId);
  if (!target) return c.json({ error: "Usuario no encontrado" }, 404);
  if (target.role === "admin") return c.json({ error: "Los admins siempre tienen acceso" }, 400);

  const before = pickAccess(target);
  const nowIso = new Date().toISOString();
  const { error } = await adminClient().from("user_profiles").update({
    access_status: "active",
    subscription_status: "active",
    suspended_at: null,
    suspension_reason: null,
    access_updated_at: nowIso,
    access_updated_by: admin.id,
    updated_at: nowIso,
  }).eq("id", targetId);
  if (error) throw new Error(error.message);

  const after = { ...before, access_status: "active", subscription_status: "active", suspended_at: null, suspension_reason: null };
  await writeAdminAudit(admin.id, targetId, "access_activated", before, after, body?.reason);
  return c.json({ success: true });
});

app.post("/make-server-da3143e6/admin/access/suspend", async (c) => {
  const auth = await requireAdmin(c.req.header("Authorization"));
  if (auth.error) return c.json(auth.error.body, auth.error.status);
  const admin = auth.profile;
  const body = await c.req.json();
  const targetId = String(body?.userId ?? "").trim();
  if (!targetId) return c.json({ error: "userId es requerido" }, 400);
  const reason = String(body?.reason ?? "").trim();
  if (!reason) return c.json({ error: "El motivo de suspensión es requerido" }, 400);
  const target = await getProfileById(targetId);
  if (!target) return c.json({ error: "Usuario no encontrado" }, 404);
  if (target.role === "admin") return c.json({ error: "Los admins no se suspenden" }, 400);

  const before = pickAccess(target);
  const nowIso = new Date().toISOString();
  const { error } = await adminClient().from("user_profiles").update({
    access_status: "suspended",
    suspended_at: nowIso,
    suspension_reason: reason,
    access_updated_at: nowIso,
    access_updated_by: admin.id,
    updated_at: nowIso,
  }).eq("id", targetId);
  if (error) throw new Error(error.message);

  const after = { ...before, access_status: "suspended", suspended_at: nowIso, suspension_reason: reason };
  await writeAdminAudit(admin.id, targetId, "access_suspended", before, after, reason);
  return c.json({ success: true });
});

app.post("/make-server-da3143e6/admin/access/revoke", async (c) => {
  const auth = await requireAdmin(c.req.header("Authorization"));
  if (auth.error) return c.json(auth.error.body, auth.error.status);
  const admin = auth.profile;
  const body = await c.req.json();
  const targetId = String(body?.userId ?? "").trim();
  if (!targetId) return c.json({ error: "userId es requerido" }, 400);
  const reason = String(body?.reason ?? "").trim() || null;
  const target = await getProfileById(targetId);
  if (!target) return c.json({ error: "Usuario no encontrado" }, 404);
  if (target.role === "admin") return c.json({ error: "Los admins no se revocan" }, 400);

  const before = pickAccess(target);
  const nowIso = new Date().toISOString();
  const { error } = await adminClient().from("user_profiles").update({
    access_status: "revoked",
    suspended_at: nowIso,
    suspension_reason: reason,
    access_updated_at: nowIso,
    access_updated_by: admin.id,
    updated_at: nowIso,
  }).eq("id", targetId);
  if (error) throw new Error(error.message);

  const after = { ...before, access_status: "revoked", suspended_at: nowIso, suspension_reason: reason };
  await writeAdminAudit(admin.id, targetId, "access_revoked", before, after, reason ?? undefined);
  return c.json({ success: true });
});

// ── Admin: eliminar usuario (flujo de alto riesgo, NUNCA masivo) ──────────────
app.post("/make-server-da3143e6/admin/users/delete", async (c) => {
  const auth = await requireAdmin(c.req.header("Authorization"));
  if (auth.error) return c.json(auth.error.body, auth.error.status);
  const admin = auth.profile;

  const body = await c.req.json();
  const targetId = String(body?.userId ?? "").trim();
  if (!targetId) return c.json({ error: "userId es requerido" }, 400);

  const target = await getProfileById(targetId);
  if (!target) return c.json({ error: "Usuario no encontrado" }, 404);

  // Confirmación explícita: el admin debe escribir el email exacto del objetivo.
  const confirmEmail = String(body?.confirmEmail ?? "").trim().toLowerCase();
  if (confirmEmail !== String(target.email ?? "").trim().toLowerCase()) {
    return c.json({ error: "El email de confirmación no coincide" }, 400);
  }
  // Nunca eliminar al admin actual ni al último admin.
  if (target.id === admin.id) return c.json({ error: "No puedes eliminarte a ti mismo" }, 400);
  if (target.role === "admin") {
    const { data: admins } = await adminClient().from("user_profiles").select("id").eq("role", "admin");
    if ((admins?.length ?? 0) <= 1) return c.json({ error: "No se puede eliminar al último admin" }, 400);
    return c.json({ error: "Eliminar un admin requiere un flujo excepcional explícito" }, 400);
  }

  const counts = await countUserData(targetId);
  const before = { ...pickAccess(target), dataCounts: counts };
  const nowIso = new Date().toISOString();

  // Auditar ANTES de borrar (referencia FK válida); al borrar el Auth user,
  // admin_audit_log.target_user_id pasará a NULL (JSON conserva la referencia).
  await writeAdminAudit(admin.id, targetId, "user_deleted", before, { email: target.email, deletedAt: nowIso }, "eliminación aprobada con email confirmado");
  await writeAudit(admin.id, "admin.user.deleted", "user_profiles", targetId, { email: target.email });

  await deleteUserData(targetId);

  const { error: delErr } = await adminClient().auth.admin.deleteUser(targetId);
  if (delErr) throw new Error(delErr.message);

  return c.json({ success: true, userId: targetId, email: target.email, deletedCounts: counts });
});

// ── Admin: historial de auditoría ─────────────────────────────────────────────
app.get("/make-server-da3143e6/admin/audit", async (c) => {
  const auth = await requireAdmin(c.req.header("Authorization"));
  if (auth.error) return c.json(auth.error.body, auth.error.status);

  const targetId = String(c.req.query("targetUserId") ?? "").trim();
  let query = adminClient()
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (targetId) query = query.eq("target_user_id", targetId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return c.json({ audit: data ?? [] });
});

Deno.serve(app.fetch);
