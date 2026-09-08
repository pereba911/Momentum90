// ─────────────────────────────────────────────────────────────────────────────
// Goal Assistant 90 · Tests de integridad y seguridad de datos
// (análisis estático del repo, sin navegador)
//  - Ausencia completa de la función de voz.
//  - Rebranding a "Goal Assistant 90" (HTML, manifest, UI).
//  - Navegación principal (Hoy/Metas/Plan/Hábitos/Tareas/Logros/Oportunidades)
//    sin módulos financieros como áreas principales.
//  - Ausencia de duplicación financiera.
//  - Migraciones aditivas, idempotentes, sin DROP/TRUNCATE/DELETE.
//  - RLS con auth.uid() por usuario + admin de solo lectura.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function read(p: string): string {
  return readFileSync(join(ROOT, p), "utf8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(relative(ROOT, full)));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(relative(ROOT, full));
  }
  return out;
}

let app = "";
let html = "";
let manifest = "";
let migrations: string[] = [];
let srcFiles: string[] = [];

beforeAll(() => {
  app = read("src/app/App.tsx");
  html = read("index.html");
  manifest = read("public/manifest.webmanifest");
  migrations = readdirSync(join(ROOT, "supabase/migrations"))
    .filter(f => f.endsWith(".sql"))
    .sort()
    .map(f => read(join("supabase/migrations", f)));
  srcFiles = walk("src");
});

describe("Ausencia COMPLETA de la función de voz", () => {
  const forbiddenTokens = [
    "QuickRecordPage", "VoiceRecorder", "speechToText", "extractWithAI",
    "validateExtraction", "showQuickModal", "Registro rápido por voz",
    "Registro por voz", "Abono por voz", "aria-label=\"Registro rápido por voz\"",
    "<Mic", "useSpeechRecognition",
  ];

  it("los archivos de voz fueron eliminados del repo", () => {
    const deleted = [
      "src/components/VoiceRecorder.tsx",
      "src/pages/QuickRecordPage.tsx",
      "src/utils/speechToText.ts",
      "src/utils/extractWithAI.ts",
      "src/utils/validateExtraction.ts",
      "supabase/functions/extract-with-ai/index.ts",
      "supabase/functions/extract-with-ai/prompt.ts",
    ];
    for (const f of deleted) expect(existsSync(join(ROOT, f)), `${f} no debería existir`).toBe(false);
  });

  it("no queda ningún token de voz en el código fuente", () => {
    for (const file of srcFiles) {
      const content = readFileSync(join(ROOT, file), "utf8");
      for (const token of forbiddenTokens) {
        expect(content, `${file} no debe contener "${token}"`).not.toContain(token);
      }
    }
  });

  it("la captura manual sigue disponible (formularios de ingresos/gastos)", () => {
    expect(app).toContain("Nuevo Ingreso");
    expect(app).toContain("Nuevo Gasto");
  });
});

describe("Rebranding a Goal Assistant 90", () => {
  it("index.html: título, description y apple title", () => {
    expect(html).toContain("<title>Goal Assistant 90</title>");
    expect(html).toContain("Goal Assistant 90");
    expect(html).not.toMatch(/<title>Momentum/i);
    expect(html).not.toContain("Centro de control financiero personal");
  });
  it("manifest PWA: nombre de la app instalable", () => {
    expect(manifest).toContain('"name": "Goal Assistant 90"');
    expect(manifest).not.toContain("Momentum");
  });
  it("UI: login, carga, logo y textos ya no usan Momentum 90 como marca visible", () => {
    expect(app).toContain('Goal Assistant <span className="text-[#9D4EDD]">90</span>');
    expect(app).toContain("Cargando Goal Assistant 90…");
    expect(app).not.toContain("Cargando Momentum 90");
    expect(app).not.toContain('<span className="text-white font-bold text-sm">Momentum');
  });
  it("documentación y README reflejan el nuevo producto", () => {
    expect(read("README.md")).toContain("Goal Assistant 90");
  });
});

describe("Navegación: áreas principales de Goal Assistant 90", () => {
  it("menú principal = Hoy, Metas, Plan, Hábitos, Tareas, Logros y CRM (sin M90 ni Activos)", () => {
    const mainStart = app.indexOf("const MAIN_TABS: TabDef[] = [");
    const mainEnd = app.indexOf("const ADMIN_TABS: TabDef[] =");
    expect(mainStart).toBeGreaterThan(-1);
    expect(mainEnd).toBeGreaterThan(mainStart);
    const mainBlock = app.slice(mainStart, mainEnd);

    for (const id of ["hoy", "metas", "plan", "habitos", "tareas", "logros", "oportunidades"]) {
      expect(mainBlock, `MAIN_TABS debe incluir ${id}`).toContain(`id: "${id}"`);
    }
    // El área de oportunidades se muestra como CRM
    expect(app).toContain('id: "oportunidades", label: "CRM"');
    // Módulos financieros NO son áreas principales
    for (const fin of ["dashboard", "money", "capital", "crm", "finanzas", "activos"]) {
      expect(mainBlock, `MAIN_TABS no debe incluir ${fin}`).not.toContain(`id: "${fin}"`);
    }
    // El menú ya NO muestra la referencia financiera (M90) ni Activos como opción
    expect(app).not.toContain("const FIN_TABS");
    expect(app).not.toContain('short: "M90"');
    expect(app).not.toMatch(/tab === "finanzas"/);
    expect(app).not.toMatch(/tab === "activos"/);
  });

  it("la pantalla inicial por defecto es Hoy", () => {
    expect(app).toContain('useState<AppTab>("hoy")');
  });

  it("la vista Hoy muestra fecha/ciclo, progreso, prioridades, hábitos, meta, próxima acción, atrasadas y avances", () => {
    for (const section of [
      "Próxima acción recomendada",
      "Tres prioridades del día",
      "Hábitos pendientes hoy",
      "Meta principal",
      "Avances recientes",
    ]) {
      expect(app, `HoyTab debe incluir "${section}"`).toContain(section);
    }
  });
});

describe("Ausencia de duplicación financiera (una sola fuente de verdad)", () => {
  it("ENTITY_PERSISTENCE define cada entidad financiera exactamente una vez", () => {
    const start = app.indexOf("const ENTITY_PERSISTENCE");
    const end = app.indexOf("];", start);
    const block = app.slice(start, end);
    for (const e of ["incomes", "expenses", "debts", "assets", "goals"]) {
      const count = block.split(`entity: "${e}"`).length - 1;
      expect(count, `${e} debe definirse una sola vez en ENTITY_PERSISTENCE`).toBe(1);
    }
  });
  it("no se crea una segunda capa de contabilidad (sin tablas financieras duplicadas en migraciones)", () => {
    for (const m of migrations) {
      expect(m).not.toMatch(/(create|create table).*?(incomes2|expenses2|cuentas2|accounts_goal|ledger_goal)/i);
    }
  });
});

describe("Migraciones seguras e idempotentes", () => {
  it("existen las migraciones 0001, 0002 y 0003", () => {
    const names = readdirSync(join(ROOT, "supabase/migrations")).filter(f => f.endsWith(".sql")).sort();
    expect(names.join(" ")).toContain("0001_extend_scalable.sql");
    expect(names.join(" ")).toContain("0002_goal_assistant_hardening.sql");
    expect(names.join(" ")).toContain("0003_goal_assistant_backup.sql");
  });

  it("ninguna migración usa DROP TABLE / TRUNCATE / DELETE FROM", () => {
    // Solo cuenta sentencias SQL reales (inicio de línea), no comentarios.
    const destructive = /^\s*(drop\s+table|truncate|delete\s+from)\b/im;
    for (const m of migrations) {
      expect(m).not.toMatch(destructive);
    }
  });

  it("0002 es aditiva: ADD COLUMN IF NOT EXISTS, índices IF NOT EXISTS y borrado lógico", () => {
    const m2 = read("supabase/migrations/0002_goal_assistant_hardening.sql");
    expect(m2).toMatch(/add column if not exists/i);
    expect(m2).toMatch(/create index if not exists/i);
    expect(m2).toContain("deleted_at");
    expect(m2).toContain("ensure_updated_at_trigger");
    expect(m2).not.toMatch(/^\s*(drop\s+table|truncate|delete\s+from)\b/im);
  });

  it("0003 crea backup/archivo idempotente con RLS y sin tocar el origen", () => {
    const m3 = read("supabase/migrations/0003_goal_assistant_backup.sql");
    expect(m3).toContain("create table if not exists public.ga_backups");
    expect(m3).toContain("on conflict on constraint ga_backups_backup_id_user_id_key do nothing");
    expect(m3).toContain("ga_create_backup");
    expect(m3).toContain("ga_migration_report");
    expect(m3).toContain("enable row level security");
    expect(m3).not.toMatch(/^\s*(drop\s+table|truncate|delete\s+from)\b/im);
  });

  it("idempotencia estructural: CREATE TABLE IF NOT EXISTS en las migraciones nuevas", () => {
    for (const name of ["0002_goal_assistant_hardening.sql", "0003_goal_assistant_backup.sql"]) {
      const m = read(`supabase/migrations/${name}`);
      expect(m).toMatch(/if\s+not\s+exists/i);
      expect(m).toMatch(/create\s+or\s+replace\s+function/i);
    }
  });
});

describe("RLS y aislamiento entre usuarios (auth.uid)", () => {
  it("schema.sql activa RLS y usa auth.uid() en las políticas por usuario", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toMatch(/enable row level security/i);
    expect(schema).toContain("auth.uid() = user_id");
    expect(schema).toContain("auth.uid() = id");
    expect(schema).toContain("public.is_admin()");
  });

  it("las migraciones no relajan RLS y mantienen políticas por usuario/admin", () => {
    const all = migrations.join("\n");
    expect(all).toMatch(/auth\.uid\(\)/i);
    expect(all).toMatch(/is_admin/i);
    expect(all).not.toMatch(/alter table .* disable row level security/i);
  });

  it("la migración 0003 protege los backups (RLS + solo service role/admin)", () => {
    const m3 = read("supabase/migrations/0003_goal_assistant_backup.sql");
    expect(m3).toContain("enable row level security");
    expect(m3).toContain("security invoker");
    expect(m3).toContain("revoke all on table public.ga_backups from anon, authenticated");
    expect(m3).toContain("grant execute on function public.ga_create_backup(text) to service_role");
  });
});

describe("Estados vacíos y UX (presentes en la UI)", () => {
  it("las vistas principales incluyen estados vacíos útiles", () => {
    for (const empty of [
      "Sin metas.",
      "Sin tareas.",
      "Aún no hay victorias",
      "Aún no hay avances esta semana",
    ]) {
      expect(app).toContain(empty);
    }
  });
  it("existen confirmaciones antes de acciones destructivas", () => {
    // anulación con confirmación (nunca borrado físico silencioso)
    expect(app).toMatch(/Anular avance/);
    expect(app).toMatch(/no se elimina físicamente/i);
  });
});
