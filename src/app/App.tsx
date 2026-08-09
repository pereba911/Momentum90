import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  LayoutDashboard, Zap, Target, Calendar, CheckSquare,
  Plus, X, Trash2, TrendingUp, TrendingDown, Trophy,
  CheckCircle2, Circle, Minus, ChevronDown, Settings,
  Building2, Pencil, ChevronLeft, ChevronRight, Star,
  LogOut, Lock, Mail, Eye, EyeOff, Award, Flame, RefreshCw,
  Wallet, ShieldCheck, Users, Plug
} from "lucide-react";
import { api, supabase, SUPABASE_CONFIGURED, type AppEntityName, type Asset, type AssetType, type IntegrationConfig } from "../lib/supabase";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PieChart, Pie, Cell, BarChart, Bar
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Currency = "MXN" | "USD" | "EUR";
type IncomeStatus = "prospect" | "projected" | "collected";
type GoalStatus = "active" | "in-progress" | "completed";
type GoalKind = "money" | "habit" | "task";
type GoalCategory = "salud_y_cuerpo" | "carrera_y_trabajo" | "dinero" | "relaciones" | "deseos_personales";
type TaskRecurringType = "none" | "daily" | "weekly" | "monthly" | "annual";
type AppTab = "dashboard" | "money" | "capital" | "plan" | "tasks" | "crm" | "logros" | "activos" | "admin";
type HabitCategory = "salud" | "negocio" | "enfoque";
type ObjType = "monetary" | "task" | "habit" | "metric" | "relationship" | "other";
type BusinessStatus = "idea" | "revision" | "por-publicar" | "marketing" | "ventas" | "negociacion" | "requerimiento" | "proceso";
type ContactStatus = "conversacion" | "interesado" | "cita" | "apartado" | "cierre";

interface HabitTier { label: string; minWeekly: number; score: number; }
interface HabitConfig { id: string; name: string; emoji: string; category: HabitCategory; maxPerDay: number; tiers: HabitTier[]; active: boolean; }
interface HabitLog { date: string; habitId: string; count: number; }
interface Income { id: string; date: string; type: string; description: string; amount: number; status: IncomeStatus; source: string; }
interface Expense { id: string; date: string; category: string; businessCategory: string; description: string; amount: number; recurring?: boolean; }
interface Debt { id: string; name: string; balance: number; minPayment: number; targetPayment: number; originalBalance: number; targetDate: string; }
interface StressEntry { date: string; level: number; }
interface Goal {
  id: string; title: string; type: "annual" | "quarterly"; quarter?: number;
  category?: GoalCategory;
  targetAmount?: number;   // meta monetaria
  currentAmount?: number;  // acumulado real
  progress: number;        // 0-100 (auto si hay targetAmount, manual si no)
  status: GoalStatus;
  kind: GoalKind;          // money | habit | task
  completedAt?: string;
}
interface Task {
  id: string;
  text: string;
  completed: boolean;
  isKey: boolean;
  createdAt: string;
  completedAt?: string;
  recurringType?: TaskRecurringType;
  recurringDays?: number[];
  dueDate?: string;
}
interface Fund { current: number; target: number; }
interface WeekObjective { id: string; title: string; type: ObjType; completed: boolean; targetAmount?: number; actualAmount?: number; targetDescription?: string; actualDescription?: string; }
interface PlanWeek { id: string; objectives: WeekObjective[]; learnings: string; }
interface Business {
  id: string; name: string; category: string; emoji: string;
  description: string; value: number; status: BusinessStatus;
  seller: string; notes: string; contactIds: string[]; createdAt: string;
}
interface Contact {
  id: string; name: string; phone: string; email: string; company: string;
  status: ContactStatus; businessIds: string[]; notes: string; createdAt: string;
}
interface RecurringExpense { id: string; category: string; businessCategory: string; description: string; amount: number; active: boolean; }
interface MiniVictory { id: string; text: string; date: string; category: "task" | "goal" | "habit" | "manual"; emoji: string; }
interface QuarterSnapshot { year: number; quarter: number; totalDays: number; goalsCompleted: number; incomeCollected: number; miniVictoriesCount: number; avgCeoScore: number; }
interface AppState {
  finance: { cash: number; receivable: number; totalDebt: number; monthlyExpense: number };
  monthlyGoal: { target: number }; quarterlyGoal: { target: number };
  stageNames: [string, string, string];
  currency: Currency;
  habitConfigs: HabitConfig[]; habitLogs: HabitLog[];
  incomes: Income[]; expenses: Expense[]; debts: Debt[];
  stressEntries: StressEntry[]; goals: Goal[]; tasks: Task[]; planWeeks: PlanWeek[];
  emergencyFund: Fund; investmentCapital: Fund; travelFund: Fund;
  businesses: Business[]; contacts: Contact[]; assets: Asset[];
  recurringExpenses: RecurringExpense[];
  monthlyFixedExpense: number;
  miniVictories: MiniVictory[];
  quarterHistory: QuarterSnapshot[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_HABITS: HabitConfig[] = [
  { id: "meds", name: "Medicamentos TDAH/Ansiedad", emoji: "💊", category: "salud", maxPerDay: 1, tiers: [{ label: "Parcial", minWeekly: 4, score: 5 }, { label: "Al día", minWeekly: 6, score: 8 }, { label: "Perfecto ✓", minWeekly: 7, score: 10 }], active: true },
  { id: "gym", name: "Gym", emoji: "🏋️", category: "salud", maxPerDay: 1, tiers: [{ label: "Bien", minWeekly: 2, score: 6 }, { label: "Ideal 💪", minWeekly: 3, score: 8 }, { label: "Extra Mile 🔥", minWeekly: 4, score: 10 }], active: true },
  { id: "swim", name: "Natación", emoji: "🏊", category: "salud", maxPerDay: 1, tiers: [{ label: "Parcial", minWeekly: 1, score: 5 }, { label: "Meta ✓", minWeekly: 2, score: 10 }], active: true },
  { id: "sleep", name: "Dormir antes 10:30", emoji: "🌙", category: "salud", maxPerDay: 1, tiers: [{ label: "Regular", minWeekly: 4, score: 5 }, { label: "Bien", minWeekly: 6, score: 8 }, { label: "Perfecto ✓", minWeekly: 7, score: 10 }], active: true },
  { id: "content", name: "Contenido en video", emoji: "🎬", category: "negocio", maxPerDay: 3, tiers: [{ label: "Ok", minWeekly: 7, score: 7 }, { label: "Muy bueno", minWeekly: 14, score: 9 }, { label: "Superb! 🔥", minWeekly: 21, score: 10 }], active: true },
  { id: "tasks", name: "Tareas clave (3/día)", emoji: "✅", category: "enfoque", maxPerDay: 3, tiers: [{ label: "Parcial", minWeekly: 7, score: 5 }, { label: "Bien", minWeekly: 14, score: 7 }, { label: "Meta! ✓", minWeekly: 21, score: 10 }], active: true },
];

const EXPENSE_CATS = ["Vivienda", "Alimentación", "Transporte", "Salud", "Servicios", "Marketing / Publicidad", "Tecnología / Software", "Nómina / Equipo", "Impuestos / Contabilidad", "Capacitación", "Legal", "Suscripciones", "Infraestructura", "Inversión", "Viajes / Networking", "Entretenimiento / Personal", "Otros"];
const INCOME_SRCS = ["Consultoría", "Bienes Raíces", "Contenido Digital", "Freelance / Proyectos", "Rentas / Propiedades", "Inversiones", "E-commerce", "Agencia", "Otro"];
const GOAL_CATEGORIES: { id: GoalCategory; label: string }[] = [
  { id: "salud_y_cuerpo", label: "Salud y cuerpo" },
  { id: "carrera_y_trabajo", label: "Carrera y trabajo" },
  { id: "dinero", label: "Dinero" },
  { id: "relaciones", label: "Relaciones" },
  { id: "deseos_personales", label: "Deseos personales" },
];
const BIZ_STATUS: { id: BusinessStatus; label: string; color: string; emoji: string }[] = [
  { id: "idea", label: "Ideas de Negocio", color: "#6b7280", emoji: "💡" },
  { id: "revision", label: "En revisión", color: "#3B82F6", emoji: "🔍" },
  { id: "por-publicar", label: "Por publicar", color: "#F59E0B", emoji: "📋" },
  { id: "marketing", label: "Marketing en proceso", color: "#9D4EDD", emoji: "📣" },
  { id: "ventas", label: "Ventas", color: "#10B981", emoji: "💰" },
  { id: "negociacion", label: "En negociación", color: "#F97316", emoji: "🤝" },
  { id: "requerimiento", label: "En requerimiento", color: "#06B6D4", emoji: "📝" },
  { id: "proceso", label: "En proceso", color: "#84CC16", emoji: "⚙️" },
];
const CONTACT_STATUS: { id: ContactStatus; label: string; color: string; emoji: string }[] = [
  { id: "conversacion", label: "En conversación", color: "#6b7280", emoji: "💬" },
  { id: "interesado", label: "Interesado", color: "#3B82F6", emoji: "👀" },
  { id: "cita", label: "Cita agendada", color: "#F59E0B", emoji: "📅" },
  { id: "apartado", label: "Apartado / Carta oferta", color: "#F97316", emoji: "📝" },
  { id: "cierre", label: "Contrato / Cierre", color: "#10B981", emoji: "🤝" },
];
const BIZ_EMOJIS = ["💼", "🏠", "🏗️", "🚀", "💡", "🎯", "📱", "🌐", "🏪", "🎬", "📦", "💎", "🔧", "✈️", "🏋️"];
const OBJ_TYPES: { id: ObjType; label: string; icon: string }[] = [{ id: "monetary", label: "Monetario", icon: "💰" }, { id: "task", label: "Tarea", icon: "✅" }, { id: "habit", label: "Hábito", icon: "🔄" }, { id: "metric", label: "Métrica", icon: "📊" }, { id: "relationship", label: "Relación", icon: "🤝" }, { id: "other", label: "Otro", icon: "⭐" }];
const PIE_COLORS = ["#9D4EDD", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#06B6D4", "#84CC16"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }
function today() { return new Date().toISOString().split("T")[0]; }
function fmt(n: number, c: Currency = "MXN"): string { const s: Record<Currency, string> = { MXN: "$", USD: "US$", EUR: "€" }; const v = Math.round(n); if (v >= 1e6) return `${s[c]}${(v / 1e6).toFixed(1)}M`; if (v >= 1000) return `${s[c]}${(v / 1000).toFixed(0)}K`; return `${s[c]}${v.toLocaleString("es-MX")}`; }
function pct(v: number, t: number): number { return t === 0 ? 0 : Math.min(100, Math.round((v / t) * 100)); }
function getQ(d = new Date()): number { return Math.floor(d.getMonth() / 3) + 1; }
function getQYear(d = new Date()): number { return d.getFullYear(); }

// Real quarter day counts per calendar
function getQTotalDays(q: number, year: number): number {
  const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
  if (q === 1) return isLeap ? 91 : 90; // Jan+Feb+Mar (Feb=28/29)
  if (q === 2) return 91;               // Apr+May+Jun (30+31+30)
  if (q === 3) return 92;               // Jul+Aug+Sep (31+31+30)
  return 92;                            // Oct+Nov+Dec (31+30+31)
}

function qStartDate(q: number, y: number): Date { return new Date(y, (q - 1) * 3, 1); }
function weekRange(wi: number, qs: Date) { const s = new Date(qs); s.setDate(s.getDate() + wi * 7); const e = new Date(s); e.setDate(e.getDate() + 6); return { start: s, end: e }; }
function fmtShort(d: Date) { return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }); }
function fmtFull(d: Date) { return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }); }
function monthLabel() { return new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric" }); }
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function getWeekMonday(d = new Date()): Date { const r = new Date(d); const day = r.getDay(); r.setDate(r.getDate() - (day === 0 ? 6 : day - 1)); r.setHours(0, 0, 0, 0); return r; }
function getWeekDays(monday: Date): Date[] { return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; }); }
function isSunday(): boolean { return new Date().getDay() === 0; }

function getHabitDayLog(logs: HabitLog[], habitId: string, date: string): number { return logs.find(l => l.habitId === habitId && l.date === date)?.count ?? 0; }
function setHabitDayLog(logs: HabitLog[], habitId: string, date: string, count: number): HabitLog[] { const f = logs.filter(l => !(l.habitId === habitId && l.date === date)); return count > 0 ? [...f, { habitId, date, count }] : f; }
function getHabitWeeklyTotal(logs: HabitLog[], habitId: string, monday: Date): number { const days = getWeekDays(monday).map(d => d.toISOString().split("T")[0]); return logs.filter(l => l.habitId === habitId && days.includes(l.date)).reduce((a, l) => a + l.count, 0); }
function getHabitScore(habit: HabitConfig, weeklyTotal: number): { score: number; label: string } { let score = 0; let label = "Sin registrar"; for (const t of habit.tiers) { if (weeklyTotal >= t.minWeekly) { score = t.score; label = t.label; } } return { score, label }; }
function calcCatScore(habits: HabitConfig[], logs: HabitLog[], cat: HabitCategory, monday: Date): number { const hs = habits.filter(h => h.active && h.category === cat); if (!hs.length) return 0; const scores = hs.map(h => getHabitScore(h, getHabitWeeklyTotal(logs, h.id, monday)).score); return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length); }
function calcAutoScores(habits: HabitConfig[], logs: HabitLog[], monday: Date, monthlyPct: number) { return { salud: calcCatScore(habits, logs, "salud", monday), enfoque: calcCatScore(habits, logs, "enfoque", monday), negocio: calcCatScore(habits, logs, "negocio", monday), dinero: Math.min(10, Math.max(1, Math.round(monthlyPct / 10))) }; }
function calcMonthlyCollected(incomes: Income[]): number { const n = new Date(); return incomes.filter(i => { if (i.status !== "collected") return false; const d = new Date(i.date); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).reduce((a, i) => a + i.amount, 0); }
function calcQCollected(incomes: Income[]): number { const n = new Date(); const q = getQ(n); const qs = qStartDate(q, n.getFullYear()); const qe = new Date(qs.getFullYear(), qs.getMonth() + 3, 0); return incomes.filter(i => { if (i.status !== "collected") return false; const d = new Date(i.date); return d >= qs && d <= qe; }).reduce((a, i) => a + i.amount, 0); }
function getBusinessStageProgress(business: Business): number {
  const idx = BIZ_STATUS.findIndex(s => s.id === business.status);
  return idx < 0 ? 0 : Math.round(((idx + 1) / BIZ_STATUS.length) * 100);
}
function getGoalProgress(g: Goal): number {
  if (g.kind === "money" && g.targetAmount && g.targetAmount > 0) {
    return Math.min(100, Math.round(((g.currentAmount ?? 0) / g.targetAmount) * 100));
  }
  return g.progress;
}

function dayOfQNow(): number { const n = new Date(); const q = getQ(n); const qs = qStartDate(q, n.getFullYear()); const total = getQTotalDays(q, n.getFullYear()); return Math.min(total, Math.max(1, Math.floor((n.getTime() - qs.getTime()) / 86400000) + 1)); }
function curWeekIndex(qs: Date): number { return Math.min(11, Math.max(0, Math.floor((Date.now() - qs.getTime()) / 86400000 / 7))); }
function genPlanWeeks(): PlanWeek[] { return Array.from({ length: 12 }, (_, i) => ({ id: `s${Math.floor(i / 4)}w${i % 4}`, objectives: [], learnings: "" })); }

function getMonthlyBurn(s: AppState): number {
  const recurring = (s.recurringExpenses || []).filter(r => r.active).reduce((a, r) => a + r.amount, 0);
  return s.monthlyFixedExpense || s.finance.monthlyExpense || recurring;
}

function mergeSavedState(parsed: Partial<AppState>): AppState {
  return {
    ...INIT,
    ...parsed,
    finance: { ...INIT.finance, ...(parsed.finance || {}) },
    monthlyGoal: { ...INIT.monthlyGoal, ...(parsed.monthlyGoal || {}) },
    quarterlyGoal: { ...INIT.quarterlyGoal, ...(parsed.quarterlyGoal || {}) },
    emergencyFund: { ...INIT.emergencyFund, ...(parsed.emergencyFund || {}) },
    investmentCapital: { ...INIT.investmentCapital, ...(parsed.investmentCapital || {}) },
    travelFund: { ...INIT.travelFund, ...(parsed.travelFund || {}) },
    habitConfigs: parsed.habitConfigs?.length ? parsed.habitConfigs : INIT.habitConfigs,
    habitLogs: parsed.habitLogs || [],
    incomes: parsed.incomes || [],
    expenses: parsed.expenses || [],
    debts: parsed.debts || [],
    stressEntries: parsed.stressEntries || [],
    goals: parsed.goals || [],
    tasks: parsed.tasks || [],
    planWeeks: parsed.planWeeks?.length ? parsed.planWeeks : INIT.planWeeks,
    businesses: parsed.businesses || [],
    contacts: parsed.contacts || [],
    assets: parsed.assets || [],
    recurringExpenses: parsed.recurringExpenses || [],
    miniVictories: parsed.miniVictories || [],
    quarterHistory: parsed.quarterHistory || [],
  };
}

function reconcileRemoteState(remoteData: Partial<AppState> | null | undefined, entities: Partial<AppState>): AppState {
  const base = mergeSavedState(remoteData ?? INIT);
  return mergeSavedState({ ...base, ...entities });
}

// ─── Initial State (vacío — datos se cargan desde Supabase) ──────────────────

const INIT: AppState = {
  finance: { cash: 0, receivable: 0, totalDebt: 0, monthlyExpense: 0 },
  monthlyGoal: { target: 0 }, quarterlyGoal: { target: 0 },
  stageNames: ["Estabilización", "Recuperación", "Expansión"],
  currency: "MXN",
  habitConfigs: DEFAULT_HABITS, habitLogs: [],
  incomes: [], expenses: [], debts: [], stressEntries: [], goals: [], tasks: [],
  planWeeks: genPlanWeeks(),
  emergencyFund: { current: 0, target: 0 },
  investmentCapital: { current: 0, target: 0 },
  travelFund: { current: 0, target: 0 },
  businesses: [], contacts: [], assets: [],
  recurringExpenses: [],
  monthlyFixedExpense: 0,
  miniVictories: [], quarterHistory: [],
};

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <div className={`bg-[#16161F] border border-white/5 rounded-2xl p-5 ${className}`}>{children}</div>; }
function BarFill({ value, max, color = "#9D4EDD", h = 6 }: { value: number; max: number; color?: string; h?: number }) { return (<div className="w-full rounded-full overflow-hidden" style={{ height: h, background: "rgba(255,255,255,0.07)" }}><div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct(value, max)}%`, background: color }} /></div>); }
type BColor = "green" | "yellow" | "red" | "purple" | "blue" | "gray" | "orange";
const BCLS: Record<BColor, string> = { green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25", yellow: "bg-amber-500/10 text-amber-400 border-amber-500/25", red: "bg-red-500/10 text-red-400 border-red-500/25", purple: "bg-purple-500/10 text-[#c084fc] border-purple-500/25", blue: "bg-blue-500/10 text-blue-400 border-blue-500/25", gray: "bg-white/5 text-gray-400 border-white/10", orange: "bg-orange-500/10 text-orange-400 border-orange-500/25" };
function Bdg({ children, color }: { children: ReactNode; color: BColor }) { return <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${BCLS[color]}`}>{children}</span>; }
function Inp({ label, value, onChange, type = "text", placeholder = "", full = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; full?: boolean }) { return (<div className={full ? "col-span-2" : ""}><label className="text-xs text-gray-500 mb-1.5 block">{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" /></div>); }

// ─── Auth Screen (Supabase real — login + registro + recuperación) ───────────

function friendlyAuthError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("rate") || m.includes("too many") || m.includes("429"))
    return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  if (m.includes("invalid") || m.includes("not found") || m.includes("email"))
    return "No se pudo enviar el enlace. Verifica que el correo sea válido e inténtalo de nuevo.";
  return msg;
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!email.trim()) return;
    setLoading(true); setError(""); setSuccess("");
    try {
      if (mode === "forgot") {
        const emailVal = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
          setError("Introduce un correo electrónico válido.");
          return;
        }
        const redirect = `${window.location.origin}/auth/reset`;
        const { error } = await supabase.auth.resetPasswordForEmail(emailVal, { redirectTo: redirect });
        if (error) setError(friendlyAuthError(error.message));
        else setSuccess("Si el correo existe, enviamos un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada (y la carpeta de spam).");
        return;
      }

      if (!pass) return;
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
        if (error) setError(error.message === "Invalid login credentials" ? "Email o contraseña incorrectos." : error.message);
      } else {
        if (pass.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
        const { error } = await supabase.auth.signUp({ email: email.trim(), password: pass });
        if (error) setError(error.message);
        else setSuccess("¡Cuenta creada! Revisa tu correo para confirmarla, o si la confirmación está desactivada, ya puedes iniciar sesión.");
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0E] flex items-center justify-center px-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#9D4EDD]/30">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-white">Momentum <span className="text-[#9D4EDD]">90</span></h1>
          <p className="text-gray-500 text-sm mt-1">Centro de control financiero personal</p>
        </div>

        <div className="flex bg-[#16161F] border border-white/5 rounded-2xl p-1 mb-5">
          {(["login", "signup"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${mode === m ? "bg-[#9D4EDD] text-white shadow" : "text-gray-500 hover:text-gray-300"}`}>
              {m === "login" ? "Iniciar sesión" : "Crear cuenta"}
            </button>
          ))}
        </div>

        <div className="bg-[#16161F] border border-white/8 rounded-3xl p-7 space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-2 flex items-center gap-1.5"><Mail size={11} /> Correo electrónico</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()}
              placeholder="tu@correo.com" autoComplete="email"
              className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-4 py-3 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
          </div>
          {mode !== "forgot" && (
            <div>
              <label className="text-xs text-gray-500 mb-2 flex items-center gap-1.5"><Lock size={11} /> Contraseña</label>
              <div className="relative">
                <input type={showPass ? "text" : "password"} value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()}
                  placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-4 py-3 pr-12 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
                <button onClick={() => setShowPass(!showPass)} className="absolute right-3.5 top-3.5 text-gray-600 hover:text-gray-300">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          {success && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">{success}</p>}
          <button onClick={handle} disabled={loading || !email || (mode !== "forgot" && !pass)}
            className="w-full py-3 bg-[#9D4EDD] text-white rounded-xl text-sm font-bold hover:bg-[#7B2CBF] transition-all disabled:opacity-50 shadow-lg shadow-[#9D4EDD]/20">
            {loading ? <span className="flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Procesando...</span>
              : mode === "forgot" ? "Enviar enlace de recuperación →" : mode === "login" ? "Entrar →" : "Crear cuenta →"}
          </button>
          {mode === "login" && (
            <button onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }} className="w-full text-center text-xs text-[#c084fc] hover:text-[#9D4EDD]">
              ¿Olvidaste tu contraseña?
            </button>
          )}
          {mode === "forgot" && (
            <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} className="w-full text-center text-xs text-gray-500 hover:text-white">
              Volver al inicio
            </button>
          )}
        </div>

        {mode === "signup" && <p className="text-center text-xs text-gray-700 mt-4">14 días gratis · $14.99 USD/mes después</p>}
        <p className="text-center text-xs text-gray-800 mt-3">Momentum 90 · v3.0</p>
      </div>
    </div>
  );
}

function ResetPasswordScreen({ hasSession }: { hasSession: boolean }) {
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Si no hay sesión de recuperación (enlace expirado o acceso directo):
  // no mostramos el formulario, avisamos y damos salida.
  if (!hasSession) {
    return (
      <div className="min-h-screen bg-[#0B0B0E] flex items-center justify-center px-4" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="w-full max-w-md bg-[#16161F] border border-white/8 rounded-3xl p-7 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Recuperación</p>
          <h2 className="text-white text-xl font-bold mb-2">Enlace no válido o expirado</h2>
          <p className="text-sm text-gray-500 mb-5">Este enlace de recuperación ya no es válido. Solicita uno nuevo desde la pantalla de inicio de sesión.</p>
          <button onClick={() => (window.location.href = "/")} className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#9D4EDD] text-white hover:bg-[#7B2CBF]">
            Ir a iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  const onSave = async () => {
    if (!newPass || !confirmPass) return;
    if (newPass.length < 6) { setMsg({ type: "error", text: "La contraseña debe tener al menos 6 caracteres." }); return; }
    if (newPass !== confirmPass) { setMsg({ type: "error", text: "Las contraseñas no coinciden." }); return; }
    setSaving(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setSaving(false);
    if (error) {
      const m = (error.message || "").toLowerCase();
      if (m.includes("expired") || m.includes("jwt") || m.includes("invalid") || m.includes("token") || m.includes("session"))
        setMsg({ type: "error", text: "El enlace ha expirado o no es válido. Solicita uno nuevo desde “¿Olvidaste tu contraseña?”." });
      else if (m.includes("weak") || m.includes("password"))
        setMsg({ type: "error", text: "La contraseña no cumple los requisitos. Usa al menos 6 caracteres." });
      else
        setMsg({ type: "error", text: error.message });
    } else {
      setMsg({ type: "success", text: "Contraseña actualizada. Puedes iniciar sesión con tu nueva contraseña." });
      setTimeout(() => (window.location.href = "/"), 1200);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0E] flex items-center justify-center px-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="w-full max-w-md bg-[#16161F] border border-white/8 rounded-3xl p-7">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Recuperación</p>
        <h2 className="text-white text-xl font-bold mb-4">Cambiar contraseña</h2>
        <div className="space-y-3">
          <div className="relative">
            <input type={showPass ? "text" : "password"} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Nueva contraseña"
              className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 pr-10 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
            <button onClick={() => setShowPass(!showPass)} className="absolute right-3 top-3 text-gray-600 hover:text-gray-300">{showPass ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
          <input type={showPass ? "text" : "password"} value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Confirmar nueva contraseña"
            className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
          {msg && (
            <p className={`text-xs px-3 py-2 rounded-xl border ${msg.type === "error" ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"}`}>
              {msg.text}
            </p>
          )}
          <button onClick={onSave} disabled={saving || !newPass || !confirmPass}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-all bg-[#9D4EDD] text-white hover:bg-[#7B2CBF] disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar contraseña"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Habit Config Modal ───────────────────────────────────────────────────────

function HabitConfigModal({ habits, onSave, onClose }: { habits: HabitConfig[]; onSave: (h: HabitConfig[]) => void; onClose: () => void }) {
  const [local, setLocal] = useState<HabitConfig[]>(habits.map(h => ({ ...h, tiers: h.tiers.map(t => ({ ...t })) })));
  const [addNew, setAddNew] = useState(false);
  const [newH, setNewH] = useState({ name: "", emoji: "⭐", category: "salud" as HabitCategory, maxPerDay: 1 });
  const toggle = (id: string) => setLocal(l => l.map(h => h.id === id ? { ...h, active: !h.active } : h));
  const updT = (hId: string, ti: number, f: keyof HabitTier, v: string | number) => setLocal(l => l.map(h => h.id === hId ? { ...h, tiers: h.tiers.map((t, i) => i === ti ? { ...t, [f]: f === "label" ? v : Number(v) } : t) } : h));
  const addHabit = () => { if (!newH.name) return; setLocal(l => [...l, { id: uid(), ...newH, tiers: [{ label: "Meta ✓", minWeekly: 1, score: 10 }], active: true }]); setAddNew(false); setNewH({ name: "", emoji: "⭐", category: "salud", maxPerDay: 1 }); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-8 px-4 overflow-y-auto pb-10">
      <div className="bg-[#16161F] border border-white/10 rounded-3xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-5 border-b border-white/5"><p className="text-white font-bold">⚙️ Configurar Hábitos</p><button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button></div>
        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {local.map(h => (
            <div key={h.id} className={`rounded-xl border p-4 transition-all ${h.active ? "border-white/8 bg-[#0D0D12]" : "border-white/3 bg-[#0D0D12]/40 opacity-60"}`}>
              <div className="flex items-center gap-3 mb-3">
                <input value={h.emoji} onChange={e => setLocal(l => l.map(x => x.id === h.id ? { ...x, emoji: e.target.value } : x))} className="w-10 text-center bg-[#16161F] border border-white/10 rounded-lg p-1 text-base" />
                <input value={h.name} onChange={e => setLocal(l => l.map(x => x.id === h.id ? { ...x, name: e.target.value } : x))} className="flex-1 bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[#9D4EDD]/50" />
                <select value={h.category} onChange={e => setLocal(l => l.map(x => x.id === h.id ? { ...x, category: e.target.value as HabitCategory } : x))} className="bg-[#16161F] border border-white/10 text-gray-400 rounded-xl px-2 py-1.5 text-xs focus:outline-none"><option value="salud">🧠 Salud</option><option value="negocio">📈 Negocio</option><option value="enfoque">🎯 Enfoque</option></select>
                <button onClick={() => toggle(h.id)} className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all shrink-0 ${h.active ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : "bg-white/5 border-white/10 text-gray-500"}`}>{h.active ? "Activo" : "Inactivo"}</button>
              </div>
              <div className="flex items-center gap-2 mb-2 text-xs text-gray-500"><span>Máx/día:</span><input type="number" min="1" max="10" value={h.maxPerDay} onChange={e => setLocal(l => l.map(x => x.id === h.id ? { ...x, maxPerDay: Number(e.target.value) } : x))} className="w-12 bg-[#16161F] border border-white/10 text-white rounded-lg px-2 py-1 text-xs text-center focus:outline-none" /></div>
              <p className="text-[11px] text-gray-600 mb-1.5">Niveles (total semanal ≥ umbral):</p>
              {h.tiers.map((t, ti) => (<div key={ti} className="flex items-center gap-2 mb-1.5"><input value={t.label} onChange={e => updT(h.id, ti, "label", e.target.value)} className="flex-1 bg-[#16161F] border border-white/10 text-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none" /><span className="text-gray-600 text-[11px]">≥</span><input type="number" value={t.minWeekly} onChange={e => updT(h.id, ti, "minWeekly", e.target.value)} className="w-12 bg-[#16161F] border border-white/10 text-white rounded-lg px-2 py-1 text-xs text-center focus:outline-none" /><span className="text-gray-600 text-[11px]">/sem</span><input type="number" min="0" max="10" value={t.score} onChange={e => updT(h.id, ti, "score", e.target.value)} className="w-10 bg-[#16161F] border border-white/10 text-[#c084fc] rounded-lg px-1 py-1 text-xs text-center focus:outline-none" /><span className="text-gray-600 text-[11px]">pts</span><button onClick={() => setLocal(l => l.map(x => x.id === h.id ? { ...x, tiers: x.tiers.filter((_, i) => i !== ti) } : x))} className="text-gray-700 hover:text-red-400"><X size={12} /></button></div>))}
              <button onClick={() => setLocal(l => l.map(x => x.id === h.id ? { ...x, tiers: [...x.tiers, { label: "Nuevo nivel", minWeekly: 1, score: 5 }] } : x))} className="text-xs text-[#c084fc] hover:text-[#9D4EDD] flex items-center gap-1 mt-1"><Plus size={11} /> Agregar nivel</button>
            </div>
          ))}
          {addNew ? (<div className="rounded-xl border border-[#9D4EDD]/30 bg-[#0D0D12] p-4 space-y-3"><div className="flex gap-2"><input value={newH.emoji} onChange={e => setNewH({ ...newH, emoji: e.target.value })} className="w-10 text-center bg-[#16161F] border border-white/10 rounded-lg p-1 text-base" /><input value={newH.name} onChange={e => setNewH({ ...newH, name: e.target.value })} placeholder="Nombre del hábito..." className="flex-1 bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#9D4EDD]/50" /></div><div className="flex gap-2"><select value={newH.category} onChange={e => setNewH({ ...newH, category: e.target.value as HabitCategory })} className="bg-[#16161F] border border-white/10 text-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none"><option value="salud">🧠 Salud</option><option value="negocio">📈 Negocio</option><option value="enfoque">🎯 Enfoque</option></select><div className="flex items-center gap-2 bg-[#16161F] border border-white/10 rounded-xl px-3 py-2"><span className="text-xs text-gray-500">Máx/día:</span><input type="number" min="1" max="10" value={newH.maxPerDay} onChange={e => setNewH({ ...newH, maxPerDay: Number(e.target.value) })} className="w-10 bg-transparent text-white text-xs text-center focus:outline-none" /></div></div><div className="flex gap-2"><button onClick={addHabit} className="px-3 py-1.5 bg-[#9D4EDD] text-white rounded-xl text-xs hover:bg-[#7B2CBF]">Agregar</button><button onClick={() => setAddNew(false)} className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl text-xs">Cancelar</button></div></div>)
            : (<button onClick={() => setAddNew(true)} className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-white/10 rounded-xl text-gray-600 hover:text-[#c084fc] hover:border-[#9D4EDD]/30 transition-all text-sm"><Plus size={14} /> Agregar hábito personalizado</button>)}
        </div>
        <div className="flex gap-2 p-5 border-t border-white/5"><button onClick={() => { onSave(local); onClose(); }} className="flex-1 py-2.5 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Guardar cambios</button><button onClick={onClose} className="px-4 py-2.5 bg-white/5 text-gray-400 rounded-xl text-sm hover:bg-white/10">Cancelar</button></div>
      </div>
    </div>
  );
}

// ─── Habit Tracker ────────────────────────────────────────────────────────────

function HabitTracker({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const [showConfig, setShowConfig] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = getWeekMonday(); const refMonday = new Date(monday); refMonday.setDate(refMonday.getDate() - weekOffset * 7);
  const days = getWeekDays(refMonday); const todayStr = today();
  const active = s.habitConfigs.filter(h => h.active);
  const mPct = pct(calcMonthlyCollected(s.incomes), s.monthlyGoal.target);
  const scores = calcAutoScores(s.habitConfigs, s.habitLogs, refMonday, mPct);
  const overall = Math.round((scores.salud + scores.enfoque + scores.negocio + scores.dinero) / 4);
  const sunday = isSunday() && weekOffset === 0;
  const catColors: Record<HabitCategory, string> = { salud: "#10B981", negocio: "#9D4EDD", enfoque: "#3B82F6" };

  return (
    <>
      {showConfig && <HabitConfigModal habits={s.habitConfigs} onSave={configs => set({ ...s, habitConfigs: configs })} onClose={() => setShowConfig(false)} />}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div><p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Hábitos Semanales</p><p className="text-sm text-gray-300 font-medium">{fmtShort(refMonday)} → {fmtShort(days[6])}{weekOffset === 0 && <span className="ml-2 text-[#c084fc] text-xs">· Semana actual</span>}</p></div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOffset(o => o + 1)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10"><ChevronLeft size={14} /></button>
            <button onClick={() => setWeekOffset(o => Math.max(0, o - 1))} disabled={weekOffset === 0} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30"><ChevronRight size={14} /></button>
            <button onClick={() => setShowConfig(true)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 hover:text-[#c084fc] hover:bg-white/10" title="Configurar"><Settings size={13} /></button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[520px]">
            <thead><tr><td className="pb-2 pr-3 w-36 text-gray-600 text-[11px]">Hábito</td>{days.map((d, i) => { const ds = d.toISOString().split("T")[0]; const isT = ds === todayStr; return (<td key={i} className="text-center pb-2 px-0.5 min-w-[30px]"><div className={`text-[11px] font-medium ${isT ? "text-[#c084fc]" : d > new Date() ? "text-gray-700" : "text-gray-500"}`}>{d.toLocaleDateString("es-MX", { weekday: "short" }).slice(0, 3)}</div><div className={`text-[10px] ${isT ? "text-[#c084fc]" : "text-gray-700"}`}>{d.getDate()}</div></td>); })}<td className="text-center pb-2 px-1 text-gray-600 text-[11px] w-12">Sem</td><td className="text-center pb-2 px-1 text-gray-600 text-[11px] w-20">Score</td></tr></thead>
            <tbody>
              {active.map(habit => {
                const wTotal = getHabitWeeklyTotal(s.habitLogs, habit.id, refMonday);
                const { score, label } = getHabitScore(habit, wTotal);
                const cc = catColors[habit.category]; const maxW = habit.tiers[habit.tiers.length - 1]?.minWeekly ?? 7;
                return (<tr key={habit.id}><td className="py-1.5 pr-3 text-[11px] whitespace-nowrap text-gray-300"><span className="mr-1">{habit.emoji}</span>{habit.name.length > 14 ? habit.name.slice(0, 14) + "…" : habit.name}</td>
                  {days.map((d, di) => { const ds = d.toISOString().split("T")[0]; const count = getHabitDayLog(s.habitLogs, habit.id, ds); const isFuture = d > new Date() && ds !== todayStr; return (<td key={di} className="text-center px-0.5 py-1.5"><button disabled={isFuture} onClick={() => !isFuture && set({ ...s, habitLogs: setHabitDayLog(s.habitLogs, habit.id, ds, count >= habit.maxPerDay ? 0 : count + 1) })} className={`w-7 h-7 rounded-lg mx-auto flex items-center justify-center text-[10px] font-bold transition-all ${count > 0 ? "border" : isFuture ? "bg-transparent border border-white/3 text-gray-800" : "bg-white/3 border border-white/8 text-gray-700 hover:border-white/20"}`} style={count > 0 ? { background: `${cc}${count >= habit.maxPerDay ? "30" : "15"}`, borderColor: `${cc}${count >= habit.maxPerDay ? "80" : "40"}`, color: cc } : {}}>{count > 0 ? (habit.maxPerDay > 1 ? count : "✓") : ""}</button></td>); })
                  }<td className="text-center px-1"><span className="font-bold text-[11px]" style={{ color: score > 0 ? cc : "#4b5563" }}>{wTotal}/{maxW}</span></td><td className="text-center px-1"><span className={`font-black text-sm ${score >= 9 ? "text-emerald-400" : score >= 7 ? "text-amber-400" : score >= 5 ? "text-[#c084fc]" : "text-gray-600"}`}>{score > 0 ? score : "—"}</span>{label !== "Sin registrar" && <p className="text-[9px] text-gray-600 whitespace-nowrap leading-tight">{label}</p>}</td></tr>);
              })}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/5">
          {([["💰 Dinero", scores.dinero, "Meta mensual"], ["🧠 Salud", scores.salud, "Hábitos salud"], ["🎯 Enfoque", scores.enfoque, "Tareas clave"], ["📈 Negocio", scores.negocio, "Contenido"]] as [string, number, string][]).map(([label, sc, note]) => { const color = sc >= 8 ? "#10B981" : sc >= 6 ? "#F59E0B" : sc >= 4 ? "#9D4EDD" : "#6b7280"; return (<div key={label} className="bg-[#0D0D12] rounded-xl p-3 border border-white/5 text-center"><p className="text-xs text-gray-500 mb-1">{label}</p><p className="text-3xl font-black" style={{ color: sc > 0 ? color : "#374151" }}>{sc > 0 ? sc : "—"}</p><div className="mt-1.5"><BarFill value={sc} max={10} color={color} h={3} /></div><p className="text-[10px] text-gray-700 mt-1">{note}</p></div>); })}
        </div>
        <div className={`mt-3 p-3.5 rounded-xl border flex items-center justify-between ${sunday ? "border-emerald-500/25 bg-emerald-500/5" : "border-white/5 bg-[#0D0D12]"}`}>
          <div><p className="text-xs font-semibold text-white">Score CEO · {fmtShort(refMonday)} – {fmtShort(days[6])}</p><p className="text-[11px] text-gray-500 mt-0.5">{sunday ? "✅ Score final — semana completada" : weekOffset === 0 ? `En curso · ${7 - new Date().getDay() || 7} días para cierre dominical` : "Semana pasada"}</p></div>
          <div className="text-right"><p className={`text-4xl font-black ${sunday ? "text-emerald-400" : "text-[#c084fc]"}`}>{overall > 0 ? overall : "—"}</p><p className="text-[10px] text-gray-600">{sunday ? "Final ✓" : "Pendiente…"}</p></div>
        </div>
      </Card>
    </>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const c = s.currency; const q = getQ(); const qYear = getQYear();
  const qs = qStartDate(q, qYear); const qTotal = getQTotalDays(q, qYear);
  const dInQ = dayOfQNow(); const wIdx = curWeekIndex(qs);
  const qMo: Record<number, string> = { 1: "Ene–Mar", 2: "Abr–Jun", 3: "Jul–Sep", 4: "Oct–Dic" };
  const cushion = getMonthlyBurn(s) > 0 ? s.finance.cash / getMonthlyBurn(s) : 0;
  const mColl = calcMonthlyCollected(s.incomes); const qColl = calcQCollected(s.incomes);
  const mP = pct(mColl, s.monthlyGoal.target); const qP = pct(qColl, s.quarterlyGoal.target);
  const pipeline = s.incomes.filter(i => i.status !== "collected").reduce((a, i) => a + i.amount, 0);
  const crmPipeline = (s.businesses || []).filter(b => b.status !== "idea" && b.status !== "ventas").reduce((a, b) => a + b.value, 0);
  const [newStress, setNewStress] = useState("");

  return (
    <div className="space-y-5">
      {/* Context pills */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="bg-[#9D4EDD]/15 border border-[#9D4EDD]/30 text-[#c084fc] px-3 py-1.5 rounded-full font-medium">Q{q} {qYear} · {qMo[q]}</span>
        <span className="bg-white/5 border border-white/10 text-gray-400 px-3 py-1.5 rounded-full">{cap(monthLabel())}</span>
        <span className="bg-white/5 border border-white/10 text-gray-400 px-3 py-1.5 rounded-full font-mono font-bold">Día {dInQ}/{qTotal}</span>
        <span className="bg-white/5 border border-white/10 text-gray-400 px-3 py-1.5 rounded-full">Semana {wIdx + 1}/12</span>
        <span className="bg-white/5 border border-white/10 text-gray-400 px-3 py-1.5 rounded-full">{pct(dInQ, qTotal)}% del trimestre</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Efectivo Disponible", val: fmt(s.finance.cash, c), sub: "Hoy", emoji: "💰", accent: "#10B981", trend: "up" as const },
          { label: "Por Cobrar", val: fmt(s.finance.receivable, c), sub: "Pendiente", emoji: "⏳", accent: "#F59E0B", trend: "flat" as const },
          { label: "Deuda Total", val: fmt(s.finance.totalDebt, c), sub: `${s.debts.length} cuentas`, emoji: "💳", accent: "#EF4444", trend: "down" as const },
          { label: "Colchón Financiero", val: `${cushion.toFixed(1)} meses`, sub: "Meta: 3 meses", emoji: "🛟", accent: cushion >= 3 ? "#10B981" : cushion >= 1 ? "#F59E0B" : "#EF4444" },
        ].map(({ label, val, sub, emoji, accent, trend }) => (
          <Card key={label} className="relative overflow-hidden group hover:border-white/10 transition-all">
            <div className="flex items-start justify-between mb-4"><div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: `${accent}18` }}>{emoji}</div>{trend && <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg ${trend === "up" ? "text-emerald-400 bg-emerald-400/10" : trend === "down" ? "text-red-400 bg-red-400/10" : "text-gray-400 bg-white/5"}`}>{trend === "up" ? <TrendingUp size={12} /> : trend === "down" ? <TrendingDown size={12} /> : <Minus size={12} />}</div>}</div>
            <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold text-white leading-none">{val}</p>
            <p className="text-xs mt-1.5" style={{ color: accent }}>{sub}</p>
            <div className="absolute bottom-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-60 transition-opacity" style={{ background: accent }} />
          </Card>
        ))}
      </div>

      {/* Monthly + Quarterly */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-start justify-between mb-1"><p className="text-xs text-gray-500 uppercase tracking-wider">Meta Mensual · {cap(monthLabel())}</p><Bdg color={mP >= 80 ? "green" : mP >= 50 ? "yellow" : "purple"}>{mP}%</Bdg></div>
          <div className="flex items-end justify-between mt-3 mb-3"><div><p className="text-3xl font-black text-white">{fmt(mColl, c)}</p><p className="text-sm text-gray-500">de <span className="text-gray-300">{fmt(s.monthlyGoal.target, c)}</span></p></div>{s.monthlyGoal.target - mColl > 0 ? <p className="text-sm text-amber-400 font-semibold text-right">Faltan<br />{fmt(s.monthlyGoal.target - mColl, c)}</p> : <p className="text-sm text-emerald-400 font-semibold text-right">✓ Meta<br />cumplida</p>}</div>
          <BarFill value={mColl} max={s.monthlyGoal.target} color={mP >= 80 ? "#10B981" : "#9D4EDD"} h={10} />
          <p className="text-[11px] text-gray-600 mt-2">Solo ingresos cobrados · configurable en Motor de Dinero</p>
        </Card>
        <Card>
          <div className="flex items-start justify-between mb-1"><p className="text-xs text-gray-500 uppercase tracking-wider">Acumulado Q{q} · {qMo[q]} {qYear}</p><Bdg color={qP >= 80 ? "green" : qP >= 50 ? "yellow" : "purple"}>{qP}%</Bdg></div>
          <div className="flex items-end justify-between mt-3 mb-3"><div><p className="text-3xl font-black text-white">{fmt(qColl, c)}</p><p className="text-sm text-gray-500">de <span className="text-gray-300">{fmt(s.quarterlyGoal.target, c)}</span></p></div>{s.quarterlyGoal.target - qColl > 0 ? <p className="text-sm text-amber-400 font-semibold text-right">Faltan<br />{fmt(s.quarterlyGoal.target - qColl, c)}</p> : <p className="text-sm text-emerald-400 font-semibold text-right">✓ Meta Q<br />cumplida</p>}</div>
          <BarFill value={qColl} max={s.quarterlyGoal.target} color={qP >= 80 ? "#10B981" : "#3B82F6"} h={10} />
          <div className="flex justify-between mt-2"><p className="text-[11px] text-gray-600">Día {dInQ}/{qTotal} del Q{q}</p><p className="text-[11px] text-gray-600">{qTotal - dInQ} días restantes</p></div>
        </Card>
      </div>

      {/* Pipeline */}
      <Card>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Pipeline General</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[["Cobrado este mes", fmt(mColl, c), "#10B981"], [`Cobrado Q${q}`, fmt(qColl, c), "#3B82F6"], ["Proyectado / prospectos", fmt(pipeline, c), "#F59E0B"], ["CRM activo", fmt(crmPipeline, c), "#9D4EDD"]].map(([l, v, col]) => (
            <div key={l as string} className="bg-[#0D0D12] rounded-xl p-3 border border-white/5"><p className="text-[11px] text-gray-500 mb-1">{l as string}</p><p className="font-bold text-base" style={{ color: col as string }}>{v as string}</p></div>
          ))}
        </div>
      </Card>

      {/* Habit Tracker */}
      <HabitTracker s={s} set={set} />

      {/* Stress + Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-2"><p className="text-xs text-gray-500 uppercase tracking-wider">Estrés Financiero</p><span className="text-2xl font-black" style={{ color: (s.stressEntries[s.stressEntries.length - 1]?.level ?? 0) <= 3 ? "#10B981" : (s.stressEntries[s.stressEntries.length - 1]?.level ?? 0) <= 6 ? "#F59E0B" : "#EF4444" }}>{s.stressEntries[s.stressEntries.length - 1]?.level ?? 0}/10</span></div>
          <div className="h-20"><ResponsiveContainer width="100%" height="100%"><AreaChart data={s.stressEntries}><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#EF4444" stopOpacity={0.3} /><stop offset="100%" stopColor="#EF4444" stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="level" stroke="#EF4444" fill="url(#sg)" strokeWidth={2} dot={false} /><Tooltip contentStyle={{ background: "#16161F", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 11, color: "#fff" }} /></AreaChart></ResponsiveContainer></div>
          <div className="flex gap-2 mt-2"><input type="number" min="1" max="10" value={newStress} onChange={e => setNewStress(e.target.value)} placeholder="1–10" className="flex-1 bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-1.5 text-xs placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/50" /><button onClick={() => { if (!newStress) return; const d = new Date().toLocaleDateString("es-MX", { month: "short", day: "numeric" }); set({ ...s, stressEntries: [...s.stressEntries.slice(-29), { date: d, level: Number(newStress) }] }); setNewStress(""); }} className="px-3 py-1.5 bg-[#9D4EDD]/20 text-[#c084fc] rounded-xl text-xs hover:bg-[#9D4EDD]/30">Registrar</button></div>
        </Card>
        <Card className="lg:col-span-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Metas del Año</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {s.goals.map(g => {
              const goalProgress = g.kind === "money" && g.targetAmount ? pct(g.currentAmount ?? 0, g.targetAmount) : g.progress;
              return (<div key={g.id} className="bg-[#0D0D12] border border-white/5 rounded-xl p-3 hover:border-white/10 transition-all"><div className="flex items-start justify-between gap-2 mb-2"><span className="text-sm text-gray-200 font-medium leading-snug">{g.title}</span><Bdg color={g.status === "completed" ? "green" : goalProgress >= 70 ? "purple" : "gray"}>{goalProgress}%</Bdg></div><BarFill value={goalProgress} max={100} h={5} color={g.status === "completed" ? "#10B981" : "#9D4EDD"} />{g.targetAmount ? <p className="text-[11px] text-gray-600 mt-1">{fmt(g.currentAmount ?? 0, c)} / {fmt(g.targetAmount, c)}</p> : null}</div>);
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── CRM Tab — Negocios + Contactos ─────────────────────────────────────────

function CRMTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const c = s.currency;
  const [view, setView] = useState<"negocios" | "contactos">("negocios");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showBizForm, setShowBizForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [editBizId, setEditBizId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);

  const emptyBiz = { name: "", category: "", emoji: "💼", description: "", value: "", status: "idea" as BusinessStatus, seller: "", notes: "", contactIds: [] as string[] };
  const emptyContact = { name: "", phone: "", email: "", company: "", status: "conversacion" as ContactStatus, businessIds: [] as string[], notes: "" };
  const [nb, setNb] = useState(emptyBiz);
  const [nc, setNc] = useState(emptyContact);

  const saveBiz = () => {
    if (!nb.name) return;
    const biz: Business = { ...nb, id: editBizId || uid(), value: Number(nb.value), createdAt: today() };
    if (editBizId) set({ ...s, businesses: s.businesses.map(b => b.id === editBizId ? biz : b) });
    else set({ ...s, businesses: [...s.businesses, biz] });
    setNb(emptyBiz); setShowBizForm(false); setEditBizId(null);
  };

  const saveContact = () => {
    if (!nc.name) return;
    const contact: Contact = { ...nc, id: editContactId || uid(), createdAt: today() };
    if (editContactId) set({ ...s, contacts: s.contacts.map(ct => ct.id === editContactId ? contact : ct) });
    else set({ ...s, contacts: [...s.contacts, contact] });
    setNc(emptyContact); setShowContactForm(false); setEditContactId(null);
  };

  const startEditBiz = (b: Business) => { setEditBizId(b.id); setNb({ ...b, value: String(b.value) } as any); setShowBizForm(true); };
  const startEditContact = (ct: Contact) => { setEditContactId(ct.id); setNc({ ...ct }); setShowContactForm(true); };

  const moveBiz = (id: string, status: BusinessStatus) => set({ ...s, businesses: s.businesses.map(b => b.id === id ? { ...b, status } : b) });
  const moveContact = (id: string, status: ContactStatus) => set({ ...s, contacts: s.contacts.map(ct => ct.id === id ? { ...ct, status } : ct) });

  const dropBiz = (status: BusinessStatus) => { if (draggingId) moveBiz(draggingId, status); setDraggingId(null); setDragOver(null); };
  const dropContact = (status: ContactStatus) => { if (draggingId) moveContact(draggingId, status); setDraggingId(null); setDragOver(null); };

  const totalBizPipeline = s.businesses.filter(b => b.status === "ventas").reduce((a, b) => a + b.value, 0);
  const activeBiz = s.businesses.filter(b => b.status !== "idea").length;

  const inpCls = "w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60";

  return (
    <div className="space-y-5">
      {/* Header + pipeline toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-[#16161F] border border-white/5 rounded-xl p-1 gap-1">
          {(["negocios", "contactos"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === v ? "bg-[#9D4EDD] text-white" : "text-gray-400 hover:text-white"}`}>
              {v === "negocios" ? "💼 Pipeline Negocios" : "👥 Pipeline Contactos"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span>En Ventas: <span className="text-emerald-400 font-bold">{fmt(totalBizPipeline, c)}</span></span>
          <span>Activos: <span className="text-[#c084fc] font-bold">{activeBiz}</span></span>
        </div>
        {view === "negocios" ? (
          <button onClick={() => { setEditBizId(null); setNb(emptyBiz); setShowBizForm(!showBizForm); }} className="flex items-center gap-2 px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">
            <Plus size={15} /> Agregar Negocio
          </button>
        ) : (
          <button onClick={() => { setEditContactId(null); setNc(emptyContact); setShowContactForm(!showContactForm); }} className="flex items-center gap-2 px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">
            <Plus size={15} /> Agregar Contacto
          </button>
        )}
      </div>

      {/* Business Form */}
      {showBizForm && view === "negocios" && (
        <Card>
          <p className="text-sm font-semibold text-white mb-4">{editBizId ? "✏️ Editar negocio" : "💼 Nuevo negocio / producto / servicio"}</p>
          <div className="grid grid-cols-2 gap-3">
            {/* Emoji picker */}
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-2 block">Emoji del negocio</label>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {BIZ_EMOJIS.map(e => (
                  <button key={e} onClick={() => setNb({ ...nb, emoji: e })} className={`text-xl p-1.5 rounded-lg transition-all ${nb.emoji === e ? "bg-[#9D4EDD]/25 scale-110" : "hover:bg-white/8"}`}>{e}</button>
                ))}
                <input value={nb.emoji} onChange={e2 => setNb({ ...nb, emoji: e2.target.value })} placeholder="✏️" className="w-14 text-center bg-[#0D0D12] border border-white/10 text-white rounded-xl px-2 py-1.5 text-sm focus:outline-none" />
              </div>
            </div>
            <Inp label="Nombre del negocio / producto" value={nb.name} onChange={v => setNb({ ...nb, name: v })} placeholder="Ej: Consultoría SEO, Casa Roma, Curso..." full />
            <Inp label="Categoría (libre)" value={nb.category} onChange={v => setNb({ ...nb, category: v })} placeholder="Bienes raíces, Digital, Servicio..." />
            <div><label className="text-xs text-gray-500 mb-1.5 block">Etapa inicial</label><select value={nb.status} onChange={e => setNb({ ...nb, status: e.target.value as BusinessStatus })} className={inpCls}>{BIZ_STATUS.map(bs => <option key={bs.id} value={bs.id}>{bs.emoji} {bs.label}</option>)}</select></div>
            <Inp label="Descripción" value={nb.description} onChange={v => setNb({ ...nb, description: v })} placeholder="Detalle del negocio..." full />
            <Inp label="Valor estimado ($)" type="number" value={nb.value} onChange={v => setNb({ ...nb, value: v })} placeholder="0" />
            <Inp label="Vendedor / Responsable" value={nb.seller} onChange={v => setNb({ ...nb, seller: v })} placeholder="Nombre de quien vende..." />
            <Inp label="Notas" value={nb.notes} onChange={v => setNb({ ...nb, notes: v })} placeholder="Observaciones..." full />
            {/* Link contacts */}
            {s.contacts.length > 0 && (
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1.5 block">Vincular contactos interesados</label>
                <div className="flex flex-wrap gap-2">{s.contacts.map(ct => (
                  <button key={ct.id} onClick={() => setNb({ ...nb, contactIds: nb.contactIds.includes(ct.id) ? nb.contactIds.filter(x => x !== ct.id) : [...nb.contactIds, ct.id] })}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${nb.contactIds.includes(ct.id) ? "bg-[#9D4EDD]/20 border-[#9D4EDD]/40 text-[#c084fc]" : "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200"}`}>
                    {ct.name}
                  </button>
                ))}</div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={saveBiz} className="px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Guardar</button>
            <button onClick={() => { setShowBizForm(false); setEditBizId(null); }} className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm hover:bg-white/10">Cancelar</button>
          </div>
        </Card>
      )}

      {/* Contact Form */}
      {showContactForm && view === "contactos" && (
        <Card>
          <p className="text-sm font-semibold text-white mb-4">{editContactId ? "✏️ Editar contacto" : "👤 Nuevo contacto / cliente"}</p>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Nombre completo" value={nc.name} onChange={v => setNc({ ...nc, name: v })} placeholder="Juan Pérez..." full />
            <Inp label="Empresa / Organización" value={nc.company} onChange={v => setNc({ ...nc, company: v })} placeholder="Empresa SA..." />
            <div><label className="text-xs text-gray-500 mb-1.5 block">Etapa</label><select value={nc.status} onChange={e => setNc({ ...nc, status: e.target.value as ContactStatus })} className={inpCls}>{CONTACT_STATUS.map(cs => <option key={cs.id} value={cs.id}>{cs.emoji} {cs.label}</option>)}</select></div>
            <Inp label="Teléfono" value={nc.phone} onChange={v => setNc({ ...nc, phone: v })} placeholder="+52 55 1234 5678" />
            <Inp label="Email" type="email" value={nc.email} onChange={v => setNc({ ...nc, email: v })} placeholder="correo@empresa.com" />
            <Inp label="Notas" value={nc.notes} onChange={v => setNc({ ...nc, notes: v })} placeholder="Intereses, observaciones..." full />
            {/* Link businesses */}
            {s.businesses.length > 0 && (
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1.5 block">Negocios de interés</label>
                <div className="flex flex-wrap gap-2">{s.businesses.map(b => (
                  <button key={b.id} onClick={() => setNc({ ...nc, businessIds: nc.businessIds.includes(b.id) ? nc.businessIds.filter(x => x !== b.id) : [...nc.businessIds, b.id] })}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${nc.businessIds.includes(b.id) ? "bg-[#9D4EDD]/20 border-[#9D4EDD]/40 text-[#c084fc]" : "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200"}`}>
                    {b.emoji} {b.name}
                  </button>
                ))}</div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={saveContact} className="px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Guardar</button>
            <button onClick={() => { setShowContactForm(false); setEditContactId(null); }} className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm hover:bg-white/10">Cancelar</button>
          </div>
        </Card>
      )}

      {/* ── KANBAN NEGOCIOS ────────────────────────────────────────────────── */}
      {view === "negocios" && (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1" style={{ minHeight: 300 }}>
          {BIZ_STATUS.map(bs => {
            const cols = s.businesses.filter(b => b.status === bs.id);
            const isDrag = dragOver === bs.id;
            return (
              <div key={bs.id}
                onDragOver={e => { e.preventDefault(); setDragOver(bs.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => dropBiz(bs.id)}
                className={`flex-shrink-0 w-60 sm:w-64 flex flex-col rounded-2xl border transition-all bg-[#16161F] ${isDrag ? "scale-[1.01] shadow-lg" : "border-white/5"}`}
                style={isDrag ? { borderColor: bs.color, borderWidth: 2, boxShadow: `0 0 20px ${bs.color}25` } : {}}>
                <div className="p-3.5 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2"><span className="text-base">{bs.emoji}</span><span className="text-sm font-semibold text-white">{bs.label}</span></div>
                  <div className="flex items-center gap-1.5">
                    {cols.length > 0 && <span className="text-[10px] text-gray-500">{fmt(cols.reduce((a, b) => a + b.value, 0), c)}</span>}
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black text-white" style={{ background: bs.color }}>{cols.length}</div>
                  </div>
                </div>
                <div className="p-2 flex-1 space-y-2">
                  {cols.map(biz => {
                    const linkedContacts = s.contacts.filter(ct => biz.contactIds.includes(ct.id) || ct.businessIds.includes(biz.id));
                    return (
                      <div key={biz.id} draggable onDragStart={() => setDraggingId(biz.id)} onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
                        className={`bg-[#0D0D12] border border-white/8 rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-white/20 hover:shadow-md transition-all ${draggingId === biz.id ? "opacity-50 scale-95" : ""}`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{biz.emoji}</span>
                            <div>
                              <p className="text-sm text-white font-semibold leading-tight">{biz.name}</p>
                              {biz.category && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${bs.color}25`, color: bs.color }}>{biz.category}</span>}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => startEditBiz(biz)} className="text-gray-600 hover:text-[#c084fc]"><Pencil size={11} /></button>
                            <button onClick={() => set({ ...s, businesses: s.businesses.filter(x => x.id !== biz.id) })} className="text-gray-600 hover:text-red-400"><Trash2 size={11} /></button>
                          </div>
                        </div>
                        {biz.description && <p className="text-[10px] text-gray-500 mb-1.5 line-clamp-2">{biz.description}</p>}
                        {biz.value > 0 && <p className="text-base font-black text-white">{fmt(biz.value, c)}</p>}
                        {biz.seller && <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-400"><span>🏷️</span><span className="truncate">{biz.seller}</span></div>}
                        {linkedContacts.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">{linkedContacts.slice(0, 3).map(ct => (
                            <span key={ct.id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">{ct.name.split(" ")[0]}</span>
                          ))}{linkedContacts.length > 3 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/8 text-gray-500">+{linkedContacts.length - 3}</span>}</div>
                        )}
                        {biz.notes && <p className="text-[10px] text-gray-600 mt-1.5 line-clamp-1">{biz.notes}</p>}
                        <div className="flex gap-1 mt-2.5">
                          {BIZ_STATUS.findIndex(x => x.id === bs.id) > 0 && <button onClick={() => moveBiz(biz.id, BIZ_STATUS[BIZ_STATUS.findIndex(x => x.id === bs.id) - 1].id)} className="flex-1 py-1 text-[10px] bg-white/5 border border-white/8 rounded-lg text-gray-500 hover:text-gray-300">← Atrás</button>}
                          {BIZ_STATUS.findIndex(x => x.id === bs.id) < BIZ_STATUS.length - 1 && <button onClick={() => moveBiz(biz.id, BIZ_STATUS[BIZ_STATUS.findIndex(x => x.id === bs.id) + 1].id)} className="flex-1 py-1 text-[10px] rounded-lg font-medium text-white" style={{ background: `${bs.color}30`, border: `1px solid ${bs.color}50`, color: bs.color }}>Avanzar →</button>}
                        </div>
                      </div>
                    );
                  })}
                  {cols.length === 0 && (<div className={`rounded-xl border-2 border-dashed h-20 flex items-center justify-center ${isDrag ? "opacity-100" : "opacity-20"}`} style={{ borderColor: bs.color }}><p className="text-xs" style={{ color: bs.color }}>Arrastra aquí</p></div>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── KANBAN CONTACTOS ───────────────────────────────────────────────── */}
      {view === "contactos" && (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1" style={{ minHeight: 300 }}>
          {CONTACT_STATUS.map(cs => {
            const cols = s.contacts.filter(ct => ct.status === cs.id);
            const isDrag = dragOver === cs.id;
            return (
              <div key={cs.id}
                onDragOver={e => { e.preventDefault(); setDragOver(cs.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => dropContact(cs.id)}
                className={`flex-shrink-0 w-60 sm:w-64 flex flex-col rounded-2xl border transition-all bg-[#16161F] ${isDrag ? "scale-[1.01] shadow-lg" : "border-white/5"}`}
                style={isDrag ? { borderColor: cs.color, borderWidth: 2, boxShadow: `0 0 20px ${cs.color}25` } : {}}>
                <div className="p-3.5 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2"><span className="text-base">{cs.emoji}</span><span className="text-sm font-semibold text-white">{cs.label}</span></div>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black text-white" style={{ background: cs.color }}>{cols.length}</div>
                </div>
                <div className="p-2 flex-1 space-y-2">
                  {cols.map(ct => {
                    const linkedBiz = s.businesses.filter(b => ct.businessIds.includes(b.id) || b.contactIds.includes(ct.id));
                    const initials = ct.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                    return (
                      <div key={ct.id} draggable onDragStart={() => setDraggingId(ct.id)} onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
                        className={`bg-[#0D0D12] border border-white/8 rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-white/20 hover:shadow-md transition-all ${draggingId === ct.id ? "opacity-50 scale-95" : ""}`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-white shrink-0" style={{ background: cs.color + "40" }}>{initials}</div>
                            <div>
                              <p className="text-sm text-white font-semibold leading-tight">{ct.name}</p>
                              {ct.company && <p className="text-[10px] text-gray-500">{ct.company}</p>}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => startEditContact(ct)} className="text-gray-600 hover:text-[#c084fc]"><Pencil size={11} /></button>
                            <button onClick={() => set({ ...s, contacts: s.contacts.filter(x => x.id !== ct.id) })} className="text-gray-600 hover:text-red-400"><Trash2 size={11} /></button>
                          </div>
                        </div>
                        {ct.phone && <p className="text-[10px] text-gray-500">📞 {ct.phone}</p>}
                        {ct.email && <p className="text-[10px] text-gray-500">✉️ {ct.email}</p>}
                        {linkedBiz.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">{linkedBiz.slice(0, 3).map(b => (
                            <span key={b.id} className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${BIZ_STATUS.find(x => x.id === b.status)?.color}20`, color: BIZ_STATUS.find(x => x.id === b.status)?.color }}>{b.emoji} {b.name.slice(0, 12)}</span>
                          ))}</div>
                        )}
                        {ct.notes && <p className="text-[10px] text-gray-600 mt-1.5 line-clamp-1">{ct.notes}</p>}
                        <div className="flex gap-1 mt-2.5">
                          {CONTACT_STATUS.findIndex(x => x.id === cs.id) > 0 && <button onClick={() => moveContact(ct.id, CONTACT_STATUS[CONTACT_STATUS.findIndex(x => x.id === cs.id) - 1].id)} className="flex-1 py-1 text-[10px] bg-white/5 border border-white/8 rounded-lg text-gray-500 hover:text-gray-300">← Atrás</button>}
                          {CONTACT_STATUS.findIndex(x => x.id === cs.id) < CONTACT_STATUS.length - 1 && <button onClick={() => moveContact(ct.id, CONTACT_STATUS[CONTACT_STATUS.findIndex(x => x.id === cs.id) + 1].id)} className="flex-1 py-1 text-[10px] rounded-lg font-medium text-white" style={{ background: `${cs.color}30`, border: `1px solid ${cs.color}50`, color: cs.color }}>Avanzar →</button>}
                          {cs.id === "cierre" && linkedBiz.length > 0 && (
                            <button onClick={() => {
                              // Mover negocios vinculados a "ventas"
                              const updatedBiz = s.businesses.map(b => (ct.businessIds.includes(b.id) || b.contactIds.includes(ct.id)) ? { ...b, status: "ventas" as BusinessStatus } : b);
                              set({ ...s, businesses: updatedBiz, contacts: s.contacts.map(x => x.id === ct.id ? { ...x, status: "cierre" } : x) });
                            }} className="flex-1 py-1 text-[9px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/25">🎉 Cerrar</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {cols.length === 0 && (<div className={`rounded-xl border-2 border-dashed h-20 flex items-center justify-center ${isDrag ? "opacity-100" : "opacity-20"}`} style={{ borderColor: cs.color }}><p className="text-xs" style={{ color: cs.color }}>Arrastra aquí</p></div>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Logros & Mini Victorias Tab ──────────────────────────────────────────────

function LogrosTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const c = s.currency;
  const [newMV, setNewMV] = useState(""); const [newMVEmoji, setNewMVEmoji] = useState("🏆");
  const [filter, setFilter] = useState<"all" | "task" | "goal" | "habit" | "manual">("all");
  const q = getQ(); const qYear = getQYear();
  const qTotal = getQTotalDays(q, qYear); const dInQ = dayOfQNow();
  const qMo: Record<number, string> = { 1: "Ene–Mar", 2: "Abr–Jun", 3: "Jul–Sep", 4: "Oct–Dic" };

  // Completed goals and tasks
  const completedGoals = s.goals.filter(g => g.status === "completed");
  const completedTasks = s.tasks.filter(t => t.completed);
  const keyTasksDone = completedTasks.filter(t => t.isKey).length;

  // Mini victorias from various sources
  const allMVs = [
    ...s.miniVictories,
    ...completedTasks.filter(t => t.isKey && t.completedAt).map(t => ({ id: "ct_" + t.id, text: t.text, date: t.completedAt || t.createdAt, category: "task" as const, emoji: "✅" })),
    ...completedGoals.filter(g => g.completedAt).map(g => ({ id: "cg_" + g.id, text: g.title, date: g.completedAt!, category: "goal" as const, emoji: "🏆" })),
  ].filter((mv, i, arr) => arr.findIndex(x => x.id === mv.id) === i)
    .sort((a, b) => b.date.localeCompare(a.date));

  const filtered = filter === "all" ? allMVs : allMVs.filter(mv => mv.category === filter);

  const addMV = () => {
    if (!newMV.trim()) return;
    set({ ...s, miniVictories: [...s.miniVictories, { id: uid(), text: newMV.trim(), date: today(), category: "manual", emoji: newMVEmoji }] });
    setNewMV("");
  };

  // Quarterly stats
  const qColl = calcQCollected(s.incomes);
  const qPct = pct(qColl, s.quarterlyGoal.target);

  // Annual overview by quarter
  const quarters = [1, 2, 3, 4].map(qn => {
    const hist = s.quarterHistory.find(h => h.year === qYear && h.quarter === qn);
    const isCurrentQ = qn === q;
    const isLocked = qn < q;
    const totalD = getQTotalDays(qn, qYear);
    if (hist && !isCurrentQ) return { q: qn, label: qMo[qn], goalsCompleted: hist.goalsCompleted, income: hist.incomeCollected, mvCount: hist.miniVictoriesCount, done: true, totalD };
    if (isCurrentQ) return { q: qn, label: qMo[qn], goalsCompleted: completedGoals.length, income: qColl, mvCount: allMVs.length, done: false, totalD, dInQ, pct: qPct };
    return { q: qn, label: qMo[qn], goalsCompleted: 0, income: 0, mvCount: 0, done: false, future: true, totalD };
  });

  const EMOJI_OPTIONS = ["🏆", "💪", "🎯", "🚀", "⚡", "✨", "🔥", "💰", "🎉", "🏅"];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#9D4EDD]/20 to-[#3B82F6]/10 border border-[#9D4EDD]/20 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-[#9D4EDD]/20 flex items-center justify-center text-2xl">🏆</div>
          <div><p className="text-white font-bold text-lg">Logros & Mini Victorias</p><p className="text-gray-400 text-sm">Tu historial de logros, victorias y metas completadas · {qYear}</p></div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[["Metas completadas", completedGoals.length, "🎯"], ["Tareas clave hechas", keyTasksDone, "✅"], ["Mini victorias total", allMVs.length, "⚡"]].map(([l, v, e]) => (
            <div key={l as string} className="bg-[#16161F]/80 rounded-xl p-3 text-center border border-white/5"><div className="text-2xl">{e as string}</div><div className="text-2xl font-black text-white mt-1">{v as number}</div><div className="text-[11px] text-gray-500 mt-0.5">{l as string}</div></div>
          ))}
        </div>
      </div>

      {/* Annual overview */}
      <Card>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Resumen Anual {qYear} · Por trimestre</p>
        <div className="space-y-3">
          {quarters.map(qt => (
            <div key={qt.q} className={`rounded-xl border p-4 ${qt.q === q ? "border-[#9D4EDD]/30 bg-[#9D4EDD]/5" : qt.done ? "border-emerald-500/20 bg-emerald-500/5" : qt.future ? "border-white/3 opacity-40" : "border-white/5"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${qt.q === q ? "bg-[#9D4EDD] text-white" : qt.done ? "bg-emerald-500 text-white" : "bg-white/10 text-gray-500"}`}>Q{qt.q}</span>
                  <span className="text-sm font-medium text-white">{qt.label}</span>
                  {qt.q === q && <Bdg color="purple">En curso · Día {dInQ}/{qTotal}</Bdg>}
                  {qt.done && <Bdg color="green">✓ Completado</Bdg>}
                  {qt.future && <Bdg color="gray">Próximo</Bdg>}
                </div>
                {!qt.future && <span className="text-[#c084fc] font-bold">{fmt(qt.income || 0, c)}</span>}
              </div>
              {!qt.future && (
                <>
                  <BarFill value={qt.q === q ? (qt.pct || 0) : (qt.done ? 100 : 0)} max={100} color={qt.done ? "#10B981" : "#9D4EDD"} h={6} />
                  <div className="flex gap-4 mt-2 text-[11px] text-gray-500">
                    <span>🎯 {qt.goalsCompleted} metas</span>
                    <span>⚡ {qt.mvCount} victorias</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Metas completadas */}
      {completedGoals.length > 0 && (
        <Card>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Metas Completadas 🏆</p>
          <div className="space-y-2">
            {completedGoals.map(g => (
              <div key={g.id} className="flex items-center gap-3 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-xl">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center text-base shrink-0">🏆</div>
                <div className="flex-1 min-w-0"><p className="text-sm text-white font-medium truncate">{g.title}</p>{g.targetAmount ? <p className="text-xs text-emerald-400">{fmt(g.currentAmount ?? 0, c)} / {fmt(g.targetAmount, c)}</p> : null}</div>
                <Bdg color="green">✓</Bdg>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Mini victorias */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Mini Victorias ⚡</p>
          <div className="flex gap-1.5">
            {([["all", "Todas"], ["task", "Tareas"], ["goal", "Metas"], ["habit", "Hábitos"], ["manual", "Manuales"]] as [typeof filter, string][]).map(([f, l]) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${filter === f ? "bg-[#9D4EDD] text-white" : "bg-white/5 text-gray-500 hover:text-gray-300"}`}>{l}</button>
            ))}
          </div>
        </div>

        {/* Add mini victoria */}
        <div className="flex gap-2 mb-4">
          <div className="flex gap-1 items-center bg-[#0D0D12] border border-white/10 rounded-xl px-2">
            {EMOJI_OPTIONS.map(e => (<button key={e} onClick={() => setNewMVEmoji(e)} className={`text-base p-1 rounded-lg transition-all ${newMVEmoji === e ? "bg-[#9D4EDD]/20 scale-110" : "hover:bg-white/5"}`}>{e}</button>))}
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          <input value={newMV} onChange={e => setNewMV(e.target.value)} onKeyDown={e => e.key === "Enter" && addMV()} placeholder="Registra una mini victoria..." className="flex-1 bg-[#0D0D12] border border-white/10 text-white rounded-xl px-4 py-2.5 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
          <button onClick={addMV} className="px-4 py-2.5 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]"><Plus size={16} /></button>
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-gray-600 text-sm text-center py-6">Aún no hay victorias en esta categoría. ¡Sigue adelante!</p>}
          {filtered.map((mv, idx) => (
            <div key={mv.id} className="flex items-center gap-3 p-3 bg-[#0D0D12] border border-white/5 rounded-xl hover:border-white/10 transition-all group">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0" style={{ background: mv.category === "goal" ? "#10B98120" : mv.category === "task" ? "#9D4EDD20" : mv.category === "habit" ? "#3B82F620" : "#F59E0B20" }}>{mv.emoji}</div>
              <div className="flex-1 min-w-0"><p className="text-sm text-gray-200 font-medium">{mv.text}</p><p className="text-[11px] text-gray-600">{mv.date} · {mv.category === "task" ? "Tarea clave" : mv.category === "goal" ? "Meta" : mv.category === "habit" ? "Hábito" : "Manual"}</p></div>
              <div className="flex items-center gap-2">
                {idx < 3 && <Star size={13} className="text-amber-400" fill="#F59E0B" />}
                {mv.category === "manual" && <button onClick={() => set({ ...s, miniVictories: s.miniVictories.filter(x => x.id !== mv.id) })} className="text-gray-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"><X size={13} /></button>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Save quarter snapshot */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Guardar snapshot del Q{q}</p>
            <p className="text-xs text-gray-500 mt-0.5">Registra el progreso acumulado de este trimestre en el historial anual</p>
          </div>
          <button onClick={() => {
            const monday = getWeekMonday(); const mPct = pct(calcMonthlyCollected(s.incomes), s.monthlyGoal.target);
            const autoSc = calcAutoScores(s.habitConfigs, s.habitLogs, monday, mPct);
            const avg = Math.round((autoSc.salud + autoSc.enfoque + autoSc.negocio + autoSc.dinero) / 4);
            const snap: QuarterSnapshot = { year: qYear, quarter: q, totalDays: qTotal, goalsCompleted: completedGoals.length, incomeCollected: qColl, miniVictoriesCount: allMVs.length, avgCeoScore: avg };
            set({ ...s, quarterHistory: [...s.quarterHistory.filter(h => !(h.year === qYear && h.quarter === q)), snap] });
          }} className="px-4 py-2.5 bg-[#9D4EDD]/15 border border-[#9D4EDD]/30 text-[#c084fc] rounded-xl text-sm font-medium hover:bg-[#9D4EDD]/25 transition-all">
            💾 Guardar Q{q}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Stub tabs ────────────────────────────────────────────────────────────────
// (Motor de Dinero, Capital, Plan, Tasks — abbreviated for space, full implementations preserved from prior version)

function MoneyTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const c = s.currency;
  const [sec, setSec] = useState<"goals" | "income" | "expenses" | "debts" | "recurrentes">("goals");
  const [showForm, setShowForm] = useState(false);
  const [ni, setNi] = useState({ date: today(), type: "", description: "", amount: "", status: "prospect" as IncomeStatus, source: "", goalId: "", goalAllocation: "" });
  const [ne, setNe] = useState({ date: today(), category: "", businessCategory: "", description: "", amount: "", recurring: false });
  // Modal de distribución de ingreso
  const [allocateIncome, setAllocateIncome] = useState<Income | null>(null);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [nd, setNd] = useState({ name: "", balance: "", minPayment: "", targetPayment: "", originalBalance: "", targetDate: "" });
  const mColl = calcMonthlyCollected(s.incomes); const qColl = calcQCollected(s.incomes);
  const q = getQ(); const qMo: Record<number, string> = { 1: "Ene–Mar", 2: "Abr–Jun", 3: "Jul–Sep", 4: "Oct–Dic" };
  const expByCat = s.expenses.reduce<Record<string, number>>((a, e) => { a[e.category] = (a[e.category] || 0) + e.amount; return a; }, {});
  const expByBiz = s.expenses.reduce<Record<string, number>>((a, e) => { const k = e.businessCategory || "Sin cat."; a[k] = (a[k] || 0) + e.amount; return a; }, {});
  const incBySrc = s.incomes.reduce<Record<string, number>>((a, i) => { const k = i.source || "Sin fuente"; a[k] = (a[k] || 0) + i.amount; return a; }, {});
  const pieData = Object.entries(expByCat).map(([name, value]) => ({ name, value }));
  const totalExp = s.expenses.reduce((a, e) => a + e.amount, 0);
  const SC: Record<IncomeStatus, BColor> = { prospect: "gray", projected: "yellow", collected: "green" };
  const SL: Record<IncomeStatus, string> = { prospect: "Prospecto", projected: "Proyectado", collected: "Cobrado" };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {([["goals", "⚙️ Metas"], ["income", "💵 Ingresos"], ["expenses", "📊 Gastos"], ["recurrentes", "🔁 Recurrentes"], ["debts", "💳 Deudas"]] as [typeof sec, string][]).map(([id, label]) => (<button key={id} onClick={() => { setSec(id as typeof sec); setShowForm(false); }} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${sec === id ? "bg-[#9D4EDD] text-white" : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/8"}`}>{label}</button>))}
        {sec !== "goals" && <button onClick={() => setShowForm(!showForm)} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-[#9D4EDD] text-white text-sm font-medium hover:bg-[#7B2CBF]"><Plus size={15} /> Agregar</button>}
      </div>

      {sec === "goals" && (<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Meta Mensual</p><div className="space-y-3"><div><label className="text-xs text-gray-500 mb-1.5 block">Meta mensual ({c})</label><input type="number" defaultValue={s.monthlyGoal.target} onBlur={e => set({ ...s, monthlyGoal: { target: Number(e.target.value) } })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60" /></div><div className="bg-[#0D0D12] rounded-xl p-4 border border-white/5 space-y-2">{[["Cobrado este mes", fmt(mColl, c), "text-emerald-400"], ["Meta", fmt(s.monthlyGoal.target, c), "text-white"], ["Faltante", fmt(Math.max(0, s.monthlyGoal.target - mColl), c), "text-amber-400"]].map(([l, v, cl]) => (<div key={l as string} className="flex justify-between text-sm"><span className="text-gray-400">{l as string}</span><span className={`font-bold ${cl as string}`}>{v as string}</span></div>))}<BarFill value={mColl} max={s.monthlyGoal.target} color="#9D4EDD" h={8} /></div></div></Card>
        <Card><p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Meta Trimestral Q{q} · {qMo[q]}</p><div className="space-y-3"><div><label className="text-xs text-gray-500 mb-1.5 block">Meta Q{q} ({c})</label><input type="number" defaultValue={s.quarterlyGoal.target} onBlur={e => set({ ...s, quarterlyGoal: { target: Number(e.target.value) } })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60" /></div><div className="bg-[#0D0D12] rounded-xl p-4 border border-white/5 space-y-2">{[["Cobrado Q" + q, fmt(qColl, c), "text-blue-400"], ["Meta", fmt(s.quarterlyGoal.target, c), "text-white"], ["Faltante", fmt(Math.max(0, s.quarterlyGoal.target - qColl), c), "text-amber-400"]].map(([l, v, cl]) => (<div key={l as string} className="flex justify-between text-sm"><span className="text-gray-400">{l as string}</span><span className={`font-bold ${cl as string}`}>{v as string}</span></div>))}<BarFill value={qColl} max={s.quarterlyGoal.target} color="#3B82F6" h={8} /></div></div></Card>
        <Card className="lg:col-span-2"><p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Datos Financieros Base</p><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{([["💰 Efectivo", "cash"], ["⏳ Por cobrar", "receivable"], ["💳 Deuda total", "totalDebt"], ["📉 Gasto mensual", "monthlyExpense"]] as [string, keyof typeof s.finance][]).map(([label, key]) => (<div key={key}><label className="text-xs text-gray-500 mb-1.5 block">{label}</label><input type="number" defaultValue={s.finance[key]} onBlur={e => set({ ...s, finance: { ...s.finance, [key]: Number(e.target.value) } })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60" /></div>))}</div></Card>
      </div>)}

      {showForm && sec === "income" && (<Card><p className="text-sm font-semibold text-white mb-4">Nuevo Ingreso</p><div className="grid grid-cols-2 gap-3"><Inp label="Fecha" type="date" value={ni.date} onChange={v => setNi({ ...ni, date: v })} /><Inp label="Tipo" value={ni.type} onChange={v => setNi({ ...ni, type: v })} placeholder="Consultoría" /><Inp label="Descripción" value={ni.description} onChange={v => setNi({ ...ni, description: v })} placeholder="Detalle..." full /><Inp label="Monto" type="number" value={ni.amount} onChange={v => setNi({ ...ni, amount: v })} placeholder="0" /><div><label className="text-xs text-gray-500 mb-1.5 block">Estado</label><select value={ni.status} onChange={e => setNi({ ...ni, status: e.target.value as IncomeStatus })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60"><option value="prospect">Prospecto</option><option value="projected">Proyectado</option><option value="collected">Cobrado</option></select></div><div><label className="text-xs text-gray-500 mb-1.5 block">Fuente / Negocio</label><select value={ni.source} onChange={e => setNi({ ...ni, source: e.target.value })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60"><option value="">Seleccionar...</option>{INCOME_SRCS.map(o => <option key={o} value={o}>{o}</option>)}</select></div><div><label className="text-xs text-gray-500 mb-1.5 block">Abonar a meta monetaria</label><select value={ni.goalId} onChange={e => setNi({ ...ni, goalId: e.target.value })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60"><option value="">Sin abono</option>{s.goals.filter(g => g.kind === "money").map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></div><Inp label="Monto a abonar a meta" type="number" value={ni.goalAllocation} onChange={v => setNi({ ...ni, goalAllocation: v })} placeholder="0" /></div><div className="flex gap-2 mt-4"><button onClick={() => { if (!ni.description || !ni.amount) return; const amount = Number(ni.amount); const goalAllocation = Number(ni.goalAllocation) || 0; let nextState = { ...s, incomes: [...s.incomes, { ...ni, id: uid(), amount }] } as AppState; if (ni.goalId && goalAllocation > 0 && amount >= goalAllocation) { nextState = { ...nextState, goals: nextState.goals.map(g => { if (g.id !== ni.goalId || g.kind !== "money") return g; const current = g.currentAmount ?? 0; const target = g.targetAmount ?? 0; const nextCurrent = current + goalAllocation; const progress = target > 0 ? Math.min(100, Math.round((nextCurrent / target) * 100)) : g.progress; return { ...g, currentAmount: nextCurrent, progress, status: target > 0 && nextCurrent >= target ? "completed" : "in-progress" }; }) }; } set(nextState); setNi({ date: today(), type: "", description: "", amount: "", status: "prospect", source: "", goalId: "", goalAllocation: "" }); setShowForm(false); }} className="px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Guardar</button><button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm">Cancelar</button></div></Card>)}

      {showForm && sec === "expenses" && (
        <Card>
          <p className="text-sm font-semibold text-white mb-4">Nuevo Gasto</p>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Fecha" type="date" value={ne.date} onChange={v => setNe({ ...ne, date: v })} />
            <Inp label="Descripción" value={ne.description} onChange={v => setNe({ ...ne, description: v })} placeholder="Detalle..." />
            <div><label className="text-xs text-gray-500 mb-1.5 block">Categoría</label><select value={ne.category} onChange={e => setNe({ ...ne, category: e.target.value })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60"><option value="">Seleccionar...</option>{EXPENSE_CATS.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
            <div><label className="text-xs text-gray-500 mb-1.5 block">Negocio / Destino</label><select value={ne.businessCategory} onChange={e => setNe({ ...ne, businessCategory: e.target.value })} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60"><option value="">Seleccionar...</option>{[...INCOME_SRCS, "Personal", "General"].map(o => <option key={o} value={o}>{o}</option>)}</select></div>
            <Inp label="Monto" type="number" value={ne.amount} onChange={v => setNe({ ...ne, amount: v })} placeholder="0" />
            <div className="flex items-center gap-3 pt-6">
              <button onClick={() => setNe({ ...ne, recurring: !ne.recurring })}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${ne.recurring ? "bg-amber-500/15 border-amber-500/30 text-amber-400" : "bg-white/5 border-white/10 text-gray-500"}`}>
                🔁 {ne.recurring ? "Recurrente mensual ✓" : "Marcar como recurrente"}
              </button>
            </div>
          </div>
          {ne.recurring && <p className="text-xs text-amber-400/70 mt-2 bg-amber-500/5 rounded-xl px-3 py-2 border border-amber-500/15">Este gasto se guardará también en la lista de gastos recurrentes mensuales y se aplicará automáticamente cada mes.</p>}
          <div className="flex gap-2 mt-4">
            <button onClick={() => {
              if (!ne.description || !ne.amount) return;
              const exp: Expense = { ...ne, id: uid(), amount: Number(ne.amount) };
              let newState = { ...s, expenses: [...s.expenses, exp] };
              // Si es recurrente, también añadir a recurringExpenses
              if (ne.recurring) {
                const rec: RecurringExpense = { id: uid(), category: ne.category, businessCategory: ne.businessCategory, description: ne.description, amount: Number(ne.amount), active: true };
                newState = { ...newState, recurringExpenses: [...s.recurringExpenses, rec] };
              }
              set(newState);
              setNe({ date: today(), category: "", businessCategory: "", description: "", amount: "", recurring: false });
              setShowForm(false);
            }} className="px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Guardar</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm">Cancelar</button>
          </div>
        </Card>
      )}

      {showForm && sec === "debts" && (<Card><p className="text-sm font-semibold text-white mb-4">Nueva Deuda</p><div className="grid grid-cols-2 gap-3"><Inp label="Nombre" value={nd.name} onChange={v => setNd({ ...nd, name: v })} placeholder="Tarjeta / Préstamo..." full /><Inp label="Saldo actual" type="number" value={nd.balance} onChange={v => setNd({ ...nd, balance: v })} placeholder="0" /><Inp label="Saldo original" type="number" value={nd.originalBalance} onChange={v => setNd({ ...nd, originalBalance: v })} placeholder="0" /><Inp label="Pago mínimo" type="number" value={nd.minPayment} onChange={v => setNd({ ...nd, minPayment: v })} placeholder="0" /><Inp label="Pago objetivo" type="number" value={nd.targetPayment} onChange={v => setNd({ ...nd, targetPayment: v })} placeholder="0" /><Inp label="Fecha objetivo" type="date" value={nd.targetDate} onChange={v => setNd({ ...nd, targetDate: v })} /></div><div className="flex gap-2 mt-4"><button onClick={() => { if (!nd.name || !nd.balance) return; set({ ...s, debts: [...s.debts, { ...nd, id: uid(), balance: Number(nd.balance), minPayment: Number(nd.minPayment), targetPayment: Number(nd.targetPayment), originalBalance: Number(nd.originalBalance) || Number(nd.balance) }] }); setNd({ name: "", balance: "", minPayment: "", targetPayment: "", originalBalance: "", targetDate: "" }); setShowForm(false); }} className="px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Guardar</button><button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm">Cancelar</button></div></Card>)}

      {sec === "income" && (<div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Card className="lg:col-span-2"><p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Todos los ingresos</p><div className="space-y-2">{s.incomes.map(inc => (<div key={inc.id} className="flex items-center gap-3 p-3 bg-[#0D0D12] rounded-xl border border-white/5 hover:border-white/10 transition-all"><div className="flex-1 min-w-0"><p className="text-sm text-white font-medium truncate">{inc.description}</p><div className="flex items-center gap-2 mt-0.5 flex-wrap"><p className="text-xs text-gray-600">{inc.date}</p>{inc.source && <Bdg color="blue">{inc.source}</Bdg>}</div></div><Bdg color={SC[inc.status]}>{SL[inc.status]}</Bdg><span className={`font-bold text-sm ${inc.status === "collected" ? "text-emerald-400" : inc.status === "projected" ? "text-amber-400" : "text-gray-500"}`}>{fmt(inc.amount, c)}</span><button onClick={() => set({ ...s, incomes: s.incomes.filter(i => i.id !== inc.id) })} className="text-gray-700 hover:text-red-400"><Trash2 size={13} /></button></div>))}</div></Card><Card><p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Por fuente</p><div className="h-36"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={Object.entries(incBySrc).map(([n, v]) => ({ name: n, value: v }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62} innerRadius={32}>{Object.keys(incBySrc).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "#16161F", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#fff", fontSize: 11 }} formatter={(v: number) => fmt(v, c)} /></PieChart></ResponsiveContainer></div><div className="space-y-1.5 mt-2">{Object.entries(incBySrc).map(([name, value], i) => (<div key={name} className="flex items-center justify-between text-xs"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} /><span className="text-gray-400 truncate max-w-[90px]">{name}</span></div><span className="text-gray-300">{fmt(value, c)}</span></div>))}</div></Card></div>)}

      {sec === "expenses" && (<div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Card className="lg:col-span-2"><div className="flex items-center justify-between mb-3"><p className="text-xs text-gray-500 uppercase tracking-wider">Gastos del mes</p><span className="text-red-400 font-bold">{fmt(totalExp, c)}</span></div><div className="space-y-2">{s.expenses.map(exp => (<div key={exp.id} className="flex items-center gap-3 p-3 bg-[#0D0D12] rounded-xl border border-white/5 hover:border-white/10 transition-all"><div className="flex-1 min-w-0"><p className="text-sm text-white font-medium truncate">{exp.description}</p><div className="flex items-center gap-2 mt-0.5 flex-wrap"><p className="text-xs text-gray-600">{exp.category} · {exp.date}</p>{exp.businessCategory && <Bdg color="purple">{exp.businessCategory}</Bdg>}</div></div><span className="font-bold text-sm text-red-400">{fmt(exp.amount, c)}</span><button onClick={() => set({ ...s, expenses: s.expenses.filter(e => e.id !== exp.id) })} className="text-gray-700 hover:text-red-400"><Trash2 size={13} /></button></div>))}</div></Card><div className="space-y-4"><Card><p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Por categoría</p><div className="h-36"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62} innerRadius={32}>{pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "#16161F", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#fff", fontSize: 11 }} formatter={(v: number) => fmt(v, c)} /></PieChart></ResponsiveContainer></div><div className="space-y-1.5 mt-2 max-h-20 overflow-y-auto">{pieData.map(({ name, value }, i) => (<div key={name} className="flex items-center justify-between text-xs"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} /><span className="text-gray-400 truncate max-w-[90px]">{name}</span></div><span className="text-gray-300">{fmt(value, c)}</span></div>))}</div></Card><Card><p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Por negocio / destino</p><div className="space-y-2">{Object.entries(expByBiz).map(([name, value], i) => (<div key={name}><div className="flex justify-between text-xs mb-1"><span className="text-gray-400 truncate">{name}</span><span className="text-gray-300">{fmt(value, c)}</span></div><BarFill value={value} max={totalExp} color={PIE_COLORS[i % PIE_COLORS.length]} h={4} /></div>))}</div></Card></div></div>)}

      {sec === "debts" && (<div className="space-y-3">{s.debts.length === 0 && <Card><p className="text-gray-600 text-sm text-center py-6">Sin deudas registradas</p></Card>}{s.debts.map(d => { const paid = d.originalBalance - d.balance; const dp = pct(paid, d.originalBalance); return (<Card key={d.id}><div className="flex items-start justify-between mb-3"><div><p className="text-white font-semibold">{d.name}</p>{d.targetDate && <p className="text-xs text-gray-600 mt-0.5">Objetivo: {d.targetDate}</p>}</div><div className="flex items-center gap-2"><Bdg color={dp >= 60 ? "green" : dp >= 30 ? "yellow" : "red"}>{dp}% pagado</Bdg><button onClick={() => set({ ...s, debts: s.debts.filter(x => x.id !== d.id) })} className="text-gray-700 hover:text-red-400"><Trash2 size={13} /></button></div></div><div className="flex items-center justify-between mb-3"><span className="text-2xl font-bold text-red-400">{fmt(d.balance, c)}</span><span className="text-sm text-gray-600">de {fmt(d.originalBalance, c)}</span></div><BarFill value={paid} max={d.originalBalance} color="#10B981" h={8} /><div className="grid grid-cols-2 gap-3 mt-3"><div className="bg-[#0D0D12] rounded-xl p-3 border border-white/5"><p className="text-[11px] text-gray-600">Pago mínimo</p><p className="text-sm font-bold text-white mt-0.5">{fmt(d.minPayment, c)}</p></div><div className="bg-[#0D0D12] rounded-xl p-3 border border-white/5"><p className="text-[11px] text-gray-600">Pago objetivo</p><p className="text-sm font-bold text-[#c084fc] mt-0.5">{fmt(d.targetPayment, c)}</p></div></div></Card>); })}</div>)}

      {/* ── Gastos Recurrentes ─────────────────────────────────────────────── */}
      {sec === "recurrentes" && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">🔁 Gastos Recurrentes Mensuales</p>
                <p className="text-[11px] text-gray-600">Estos gastos se aplican automáticamente cada mes. El total determina el cálculo del colchón financiero.</p>
              </div>
            </div>
            {/* Gasto fijo configurado */}
            <div className="bg-[#0D0D12] rounded-xl p-4 border border-white/5 mb-4">
              <p className="text-xs text-gray-500 mb-2">Gasto mensual fijo configurado (para cálculo del dashboard)</p>
              <div className="flex items-center gap-3">
                <input type="number" defaultValue={s.monthlyFixedExpense || s.finance.monthlyExpense} onBlur={e => set({ ...s, monthlyFixedExpense: Number(e.target.value), finance: { ...s.finance, monthlyExpense: Number(e.target.value) } })}
                  className="flex-1 bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60" />
                <span className="text-xs text-gray-500">{c}/mes</span>
              </div>
              <p className="text-[11px] text-gray-600 mt-2">Este valor se usa para calcular "Meses de colchón" en el Dashboard = Efectivo disponible ÷ este valor</p>
            </div>

            {/* Lista de recurrentes */}
            {s.recurringExpenses.length === 0 && <p className="text-gray-600 text-sm text-center py-4">Sin gastos recurrentes. Agrégalos desde la sección "Gastos" marcando la opción 🔁.</p>}
            <div className="space-y-2">
              {s.recurringExpenses.map(r => (
                <div key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${r.active ? "bg-[#0D0D12] border-white/5" : "bg-[#0D0D12]/40 border-white/3 opacity-50"}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{r.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-gray-600">{r.category}</p>
                      {r.businessCategory && <Bdg color="purple">{r.businessCategory}</Bdg>}
                      <Bdg color={r.active ? "green" : "gray"}>{r.active ? "Activo" : "Inactivo"}</Bdg>
                    </div>
                  </div>
                  <span className="font-bold text-sm text-red-400">{fmt(r.amount, c)}/mes</span>
                  <button onClick={() => set({ ...s, recurringExpenses: s.recurringExpenses.map(x => x.id === r.id ? { ...x, active: !x.active } : x) })}
                    className="text-xs px-2 py-1 bg-white/5 border border-white/10 text-gray-400 rounded-lg hover:text-white">
                    {r.active ? "Pausar" : "Activar"}
                  </button>
                  <button onClick={() => set({ ...s, recurringExpenses: s.recurringExpenses.filter(x => x.id !== r.id) })} className="text-gray-700 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            {/* Total */}
            {s.recurringExpenses.length > 0 && (
              <div className="mt-4 p-3 bg-red-500/5 border border-red-500/15 rounded-xl flex items-center justify-between">
                <span className="text-sm text-gray-400">Total recurrente mensual</span>
                <span className="text-red-400 font-bold">{fmt(s.recurringExpenses.filter(r => r.active).reduce((a, r) => a + r.amount, 0), c)}/mes</span>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function CapitalTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const c = s.currency;
  const [showForm, setShowForm] = useState(false);
  const [abonarId, setAbonarId] = useState<string | null>(null);
  const [abonarAmt, setAbonarAmt] = useState("");
  const [ng, setNg] = useState({ title: "", type: "annual" as "annual" | "quarterly", targetAmount: "", kind: "money" as GoalKind, category: "dinero" as GoalCategory });

  const funds = [
    { key: "emergencyFund" as const, label: "🛟 Emergencia", color: "#10B981" },
    { key: "investmentCapital" as const, label: "📈 Inversión", color: "#9D4EDD" },
    { key: "travelFund" as const, label: "✈️ Viajes / Personal", color: "#3B82F6" },
  ];

  // Calcular progreso automático para metas monetarias
  const goalWithProgress = (g: Goal): Goal => {
    if (g.kind === "money" && g.targetAmount && g.targetAmount > 0) {
      const cur = g.currentAmount ?? 0;
      return { ...g, progress: pct(cur, g.targetAmount), status: cur >= g.targetAmount ? "completed" : g.progress === 0 ? "active" : "in-progress" };
    }
    return g;
  };

  const addGoal = () => {
    if (!ng.title) return;
    const newGoal: Goal = {
      id: uid(), title: ng.title, type: ng.type, progress: 0, status: "active",
      kind: ng.kind,
      category: ng.category,
      targetAmount: ng.kind === "money" && ng.targetAmount ? Number(ng.targetAmount) : undefined,
      currentAmount: ng.kind === "money" ? 0 : undefined,
    };
    set({ ...s, goals: [...s.goals, newGoal] });
    setNg({ title: "", type: "annual", targetAmount: "", kind: "money", category: "dinero" }); setShowForm(false);
  };

  const abonandoRef = useRef(false);
  const doAbonar = (gId: string) => {
    const amt = Number(abonarAmt);
    if (!amt || amt <= 0) return;
    if (abonandoRef.current) return; // evita doble abono por doble clic
    abonandoRef.current = true;
    set({
      ...s, goals: s.goals.map(g => {
        if (g.id !== gId) return g;
        const newCur = (g.currentAmount ?? 0) + amt;
        const newPct = g.targetAmount ? pct(newCur, g.targetAmount) : g.progress;
        return { ...g, currentAmount: newCur, progress: Math.min(100, newPct), status: newPct >= 100 ? "completed" : "in-progress", completedAt: newPct >= 100 ? today() : undefined };
      })
    });
    setAbonarId(null); setAbonarAmt("");
    setTimeout(() => { abonandoRef.current = false; }, 400);
  };

  const ic = "w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-2 py-1.5 text-xs focus:outline-none";

  return (
    <div className="space-y-5">
      {/* Fondos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {funds.map(({ key, label, color }) => {
          const fund = s[key]; const p = pct(fund.current, fund.target);
          return (
            <Card key={key}>
              <p className="text-sm font-semibold text-white mb-3">{label}</p>
              <p className="text-3xl font-black text-white">{fmt(fund.current, c)}</p>
              <p className="text-xs text-gray-500 mb-3">de {fmt(fund.target, c)}</p>
              <BarFill value={fund.current} max={fund.target} color={color} h={8} />
              <div className="flex items-center justify-between mt-2 mb-3">
                <span className="text-xs text-gray-600">Faltante: {fmt(fund.target - fund.current, c)}</span>
                <span className="font-bold text-sm" style={{ color }}>{p}%</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[11px] text-gray-600 block mb-1">Actual ({c})</label><input type="number" defaultValue={fund.current} onBlur={e => set({ ...s, [key]: { ...fund, current: Number(e.target.value) } })} className={ic} /></div>
                <div><label className="text-[11px] text-gray-600 block mb-1">Meta ({c})</label><input type="number" defaultValue={fund.target} onBlur={e => set({ ...s, [key]: { ...fund, target: Number(e.target.value) } })} className={ic} /></div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Metas con tracking monetario */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Metas · Seguimiento monetario</p>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 text-xs text-[#c084fc] hover:text-[#9D4EDD]"><Plus size={13} /> Agregar</button>
        </div>

        {showForm && (
          <div className="bg-[#0D0D12] rounded-xl p-4 border border-white/8 mb-4 space-y-3">
            <input value={ng.title} onChange={e => setNg({ ...ng, title: e.target.value })} placeholder="Título de la meta..." className="w-full bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm placeholder-gray-700 focus:outline-none" />
            <div className="grid grid-cols-3 gap-2">
              <select value={ng.type} onChange={e => setNg({ ...ng, type: e.target.value as "annual" | "quarterly" })} className="bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm focus:outline-none">
                <option value="annual">Anual</option><option value="quarterly">Trimestral</option>
              </select>
              <select value={ng.kind} onChange={e => setNg({ ...ng, kind: e.target.value as GoalKind })} className="bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm focus:outline-none">
                <option value="money">💰 Monetaria</option>
                <option value="habit">🔄 Hábito</option>
                <option value="task">✅ Tarea</option>
              </select>
              <select value={ng.category} onChange={e => setNg({ ...ng, category: e.target.value as GoalCategory })} className="bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm focus:outline-none">
                {GOAL_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {ng.kind === "money" && <input type="number" value={ng.targetAmount} onChange={e => setNg({ ...ng, targetAmount: e.target.value })} placeholder="Meta en $" className="bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm placeholder-gray-700 focus:outline-none" />}
            </div>
            <div className="flex gap-2">
              <button onClick={addGoal} className="px-3 py-1.5 bg-[#9D4EDD] text-white rounded-xl text-xs hover:bg-[#7B2CBF]">Guardar</button>
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl text-xs">Cancelar</button>
            </div>
          </div>
        )}

        {s.goals.length === 0 && <p className="text-gray-600 text-sm text-center py-4">Sin metas. Agrega tu primera meta arriba.</p>}

        <div className="space-y-3">
          {s.goals.map(g => {
            const computed = goalWithProgress(g);
            const isMoney = computed.kind === "money" && computed.targetAmount;
            const isAbonar = abonarId === computed.id;
            return (
              <div key={computed.id} className="group">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-sm text-gray-200 truncate">{computed.title}</span>
                      <Bdg color={computed.kind === "money" ? "green" : computed.kind === "habit" ? "blue" : "gray"}>
                        {computed.kind === "money" ? "💰" : computed.kind === "habit" ? "🔄" : "✅"} {computed.type === "quarterly" ? "Q" : "Anual"}
                      </Bdg>
                      {computed.category && <Bdg color="purple">{GOAL_CATEGORIES.find(c => c.id === computed.category)?.label ?? computed.category}</Bdg>}
                      {computed.status === "completed" && <Bdg color="green">✓ Completada</Bdg>}
                    </div>
                    {isMoney && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                        <span className="text-emerald-400 font-semibold">{fmt(computed.currentAmount ?? 0, c)}</span>
                        <span>/</span>
                        <span className="text-gray-400">{fmt(computed.targetAmount!, c)}</span>
                        <span className="text-gray-600">faltante: {fmt(Math.max(0, computed.targetAmount! - (computed.currentAmount ?? 0)), c)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <BarFill value={computed.progress} max={100} h={5} color={computed.status === "completed" ? "#10B981" : "#9D4EDD"} />
                      <span className="text-xs text-gray-500 w-8 text-right">{computed.progress}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isMoney && computed.status !== "completed" && (
                      <button onClick={() => { setAbonarId(isAbonar ? null : computed.id); setAbonarAmt(""); }}
                        className="text-xs px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/20">
                        + Abonar
                      </button>
                    )}
                    {computed.kind !== "money" && computed.status !== "completed" && (
                      <button onClick={() => { const np = Math.min(100, computed.progress + 20); set({ ...s, goals: s.goals.map(x => x.id === computed.id ? { ...x, progress: np, status: np >= 100 ? "completed" : "in-progress", completedAt: np >= 100 ? today() : undefined } : x) }); }}
                        className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 hover:text-white text-[10px] opacity-0 group-hover:opacity-100">+</button>
                    )}
                    <button onClick={() => set({ ...s, goals: s.goals.filter(x => x.id !== computed.id) })} className="text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash2 size={12} /></button>
                  </div>
                </div>
                {isAbonar && (
                  <div className="mt-2 flex gap-2 items-center bg-[#0D0D12] rounded-xl p-2.5 border border-emerald-500/20">
                    <span className="text-xs text-gray-500">Abonar:</span>
                    <input type="number" value={abonarAmt} onChange={e => setAbonarAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && doAbonar(computed.id)} placeholder={`Monto en ${c}`} autoFocus
                      className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-gray-700" />
                    <button onClick={() => doAbonar(computed.id)} className="px-3 py-1 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600">✓ Agregar</button>
                    <button onClick={() => setAbonarId(null)} className="text-gray-600 hover:text-gray-300"><X size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function PlanTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const c = s.currency; const now = new Date(); const q = getQ(now); const qYear = getQYear(now); const qs = qStartDate(q, qYear);
  const qTotal = getQTotalDays(q, qYear); const qMo: Record<number, string> = { 1: "Enero – Marzo", 2: "Abril – Junio", 3: "Julio – Septiembre", 4: "Octubre – Diciembre" };
  const dInQ = dayOfQNow(); const [editStage, setEditStage] = useState<number | null>(null); const [stageDraft, setStageDraft] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null); const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newObj, setNewObj] = useState({ title: "", type: "monetary" as ObjType, targetAmount: "", actualAmount: "", targetDescription: "", actualDescription: "", completed: false });
  const [editLrn, setEditLrn] = useState<string | null>(null); const [lrnDraft, setLrnDraft] = useState("");
  function getWeek(id: string): PlanWeek { return s.planWeeks.find(w => w.id === id) || { id, objectives: [], learnings: "" }; }
  function updateWeek(u: PlanWeek) { const ex = s.planWeeks.some(w => w.id === u.id); set({ ...s, planWeeks: ex ? s.planWeeks.map(w => w.id === u.id ? u : w) : [...s.planWeeks, u] }); }
  function addObj(wid: string) { if (!newObj.title.trim()) return; const obj: WeekObjective = { id: uid(), title: newObj.title.trim(), type: newObj.type, completed: newObj.completed, ...(newObj.type === "monetary" ? { targetAmount: newObj.targetAmount ? Number(newObj.targetAmount) : undefined, actualAmount: newObj.actualAmount ? Number(newObj.actualAmount) : undefined } : { targetDescription: newObj.targetDescription, actualDescription: newObj.actualDescription }) }; const w = getWeek(wid); updateWeek({ ...w, objectives: [...w.objectives, obj] }); setNewObj({ title: "", type: "monetary", targetAmount: "", actualAmount: "", targetDescription: "", actualDescription: "", completed: false }); setAddingTo(null); }
  const stages = [0, 1, 2].map(si => ({ si, name: s.stageNames[si], color: ["#3B82F6", "#F59E0B", "#10B981"][si], weeks: [0, 1, 2, 3].map(wi => { const ai = si * 4 + wi; const { start, end } = weekRange(ai, qs); const wid = `s${si}w${wi}`; const pw = getWeek(wid); const isCurrent = now >= start && now <= end; const isPast = now > end; return { ai, wid, start, end, pw, isCurrent, isPast, weekNum: ai + 1 }; }) }));
  return (<div className="space-y-5">
    <Card><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4"><div><p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Plan Trimestral · Q{q} {qYear}</p><p className="text-xl font-bold text-white">{qMo[q]}</p><p className="text-sm text-gray-500 mt-0.5">{fmtFull(qs)} → {fmtFull(new Date(qs.getFullYear(), qs.getMonth() + 3, 0))}</p></div><div className="text-right"><p className="text-4xl font-black text-[#9D4EDD]">{pct(dInQ, qTotal)}%</p><p className="text-xs text-gray-500">Día {dInQ}/{qTotal}</p></div></div><BarFill value={dInQ} max={qTotal} color="#9D4EDD" h={10} /><div className="flex mt-2">{stages.map(({ si, name, color }) => (<div key={si} className="flex-1 text-center"><div className="h-1 rounded-full mx-0.5" style={{ background: color }} /><p className="text-[10px] text-gray-600 mt-1 truncate">{name}</p></div>))}</div></Card>
    {stages.map(({ si, name, color, weeks }) => (<Card key={si} className={weeks.some(w => w.isCurrent) ? "border-[#9D4EDD]/20" : ""}><div className="flex items-center gap-3 mb-4"><div className="w-3 h-8 rounded-full shrink-0" style={{ background: color }} /><div className="flex-1">{editStage === si ? (<div className="flex items-center gap-2"><input value={stageDraft} onChange={e => setStageDraft(e.target.value)} autoFocus onKeyDown={e => { if (e.key === "Enter") { const n = [...s.stageNames] as [string, string, string]; n[si] = stageDraft || n[si]; set({ ...s, stageNames: n }); setEditStage(null); } if (e.key === "Escape") setEditStage(null); }} className="bg-[#0D0D12] border border-[#9D4EDD]/40 text-white rounded-xl px-3 py-1.5 text-sm font-semibold focus:outline-none" /><button onClick={() => { const n = [...s.stageNames] as [string, string, string]; n[si] = stageDraft || n[si]; set({ ...s, stageNames: n }); setEditStage(null); }} className="text-[#c084fc] text-xs px-2 py-1 bg-[#9D4EDD]/15 rounded-lg">✓</button><button onClick={() => setEditStage(null)} className="text-gray-500"><X size={14} /></button></div>) : (<div className="flex items-center gap-2"><p className="text-white font-semibold text-lg">{name}</p><button onClick={() => { setEditStage(si); setStageDraft(name); }} className="text-gray-600 hover:text-[#c084fc]"><Pencil size={13} /></button></div>)}<p className="text-xs text-gray-500">Sem {si * 4 + 1}–{si * 4 + 4} · {fmtShort(weeks[0].start)} → {fmtShort(weeks[3].end)}</p></div>{weeks.some(w => w.isCurrent) && <Bdg color="purple">En curso</Bdg>}</div>
      <div className="space-y-2">{weeks.map(({ wid, weekNum, start, end, pw, isCurrent, isPast }) => { const isExp = expanded === wid; const isAdding = addingTo === wid; const done = pw.objectives.filter(o => o.completed).length; const total = pw.objectives.length; const mT = pw.objectives.filter(o => o.type === "monetary").reduce((a, o) => a + (o.targetAmount || 0), 0); const mA = pw.objectives.filter(o => o.type === "monetary").reduce((a, o) => a + (o.actualAmount || 0), 0); return (<div key={wid} className={`rounded-xl border transition-all ${isCurrent ? "border-[#9D4EDD]/40 bg-[#9D4EDD]/5" : isPast ? "border-white/5 bg-[#0D0D12]" : "border-white/3 bg-[#0D0D12]/40"}`}><button className="w-full flex items-center gap-3 p-3.5 text-left" onClick={() => setExpanded(isExp ? null : wid)}><div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${isCurrent ? "text-white" : isPast ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-gray-600"}`} style={isCurrent ? { background: color } : {}}>{weekNum}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className={`text-sm font-semibold ${isCurrent ? "text-white" : isPast ? "text-gray-400" : "text-gray-500"}`}>Semana {weekNum}</span><span className="text-xs text-gray-600">{fmtShort(start)} → {fmtShort(end)}</span>{isCurrent && <Bdg color="purple">← Hoy</Bdg>}</div>{total > 0 ? <p className="text-xs text-gray-500 mt-0.5">{done}/{total} objetivos{mT > 0 ? ` · ${fmt(mA, c)}/${fmt(mT, c)}` : ""}</p> : <p className="text-xs text-gray-600 italic mt-0.5">Sin objetivos</p>}</div>{total > 0 && <div className="hidden md:flex items-center gap-2 mr-2"><div className="w-16 h-1.5 rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${pct(done, total)}%`, background: color }} /></div><span className="text-xs text-gray-500">{pct(done, total)}%</span></div>}<ChevronDown size={16} className={`text-gray-500 shrink-0 transition-transform ${isExp ? "rotate-180" : ""}`} /></button>
        {isExp && (<div className="px-3.5 pb-3.5 border-t border-white/5 pt-3 space-y-3">{pw.objectives.map(obj => { const ti = OBJ_TYPES.find(t => t.id === obj.type) || OBJ_TYPES[0]; return (<div key={obj.id} className={`flex items-start gap-3 p-3 rounded-xl border ${obj.completed ? "border-emerald-500/15 bg-emerald-500/5" : "border-white/5 bg-[#16161F]"}`}><button onClick={() => { const w = getWeek(wid); updateWeek({ ...w, objectives: w.objectives.map(o => o.id === obj.id ? { ...o, completed: !o.completed } : o) }); }} className="shrink-0 mt-0.5">{obj.completed ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Circle size={16} className="text-gray-600" />}</button><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span>{ti.icon}</span><span className={`text-sm font-medium ${obj.completed ? "line-through text-gray-500" : "text-gray-200"}`}>{obj.title}</span></div>{obj.type === "monetary" && (obj.targetAmount || obj.actualAmount) && <div className="flex gap-3 mt-1">{obj.targetAmount && <span className="text-xs text-gray-500">Meta: <span className="text-amber-400 font-medium">{fmt(obj.targetAmount, c)}</span></span>}{obj.actualAmount !== undefined && <span className="text-xs text-gray-500">Real: <span className={`font-medium ${(obj.actualAmount || 0) >= (obj.targetAmount || 0) ? "text-emerald-400" : "text-red-400"}`}>{fmt(obj.actualAmount, c)}</span></span>}</div>}{obj.type !== "monetary" && obj.targetDescription && <p className="text-xs text-gray-500 mt-1">Meta: <span className="text-gray-400">{obj.targetDescription}</span></p>}</div><button onClick={() => { const w = getWeek(wid); updateWeek({ ...w, objectives: w.objectives.filter(o => o.id !== obj.id) }); }} className="text-gray-700 hover:text-red-400 shrink-0"><Trash2 size={12} /></button></div>); })}
          {isAdding ? (<div className="bg-[#0D0D12] rounded-xl border border-[#9D4EDD]/20 p-4 space-y-3"><p className="text-xs text-[#c084fc] font-semibold uppercase tracking-wider">Nuevo objetivo</p><input value={newObj.title} onChange={e => setNewObj({ ...newObj, title: e.target.value })} placeholder="Título..." className="w-full bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" /><div className="grid grid-cols-3 gap-2">{OBJ_TYPES.map(t => (<button key={t.id} onClick={() => setNewObj({ ...newObj, type: t.id })} className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${newObj.type === t.id ? "border-[#9D4EDD]/50 bg-[#9D4EDD]/10" : "border-white/5 bg-[#16161F] hover:border-white/15"}`}><span>{t.icon}</span><span className={`text-xs font-medium mt-1 ${newObj.type === t.id ? "text-[#c084fc]" : "text-gray-400"}`}>{t.label}</span></button>))}</div>{newObj.type === "monetary" ? (<div className="grid grid-cols-2 gap-3"><Inp label="💰 Meta ($)" type="number" value={newObj.targetAmount} onChange={v => setNewObj({ ...newObj, targetAmount: v })} placeholder="0" /><Inp label="✅ Real ($)" type="number" value={newObj.actualAmount} onChange={v => setNewObj({ ...newObj, actualAmount: v })} placeholder="0" /></div>) : (<div className="grid grid-cols-2 gap-3"><Inp label="🎯 ¿Qué lograr?" value={newObj.targetDescription} onChange={v => setNewObj({ ...newObj, targetDescription: v })} placeholder="Meta..." /><Inp label="📝 Resultado" value={newObj.actualDescription} onChange={v => setNewObj({ ...newObj, actualDescription: v })} placeholder="¿Qué lograste?" /></div>)}<div className="flex gap-2"><button onClick={() => addObj(wid)} className="px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Guardar</button><button onClick={() => setAddingTo(null)} className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm">Cancelar</button></div></div>)
            : (<button onClick={() => { setAddingTo(wid); setNewObj({ title: "", type: "monetary", targetAmount: "", actualAmount: "", targetDescription: "", actualDescription: "", completed: false }); }} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-white/10 rounded-xl text-gray-600 hover:text-[#c084fc] hover:border-[#9D4EDD]/30 transition-all text-sm"><Plus size={14} /> Agregar objetivo</button>)}
          <div><p className="text-xs text-gray-500 mb-1.5">📖 Aprendizajes</p>{editLrn === wid ? (<div className="space-y-2"><textarea value={lrnDraft} onChange={e => setLrnDraft(e.target.value)} rows={2} className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60 resize-none" /><div className="flex gap-2"><button onClick={() => { updateWeek({ ...pw, learnings: lrnDraft }); setEditLrn(null); }} className="px-3 py-1.5 bg-[#9D4EDD] text-white rounded-xl text-xs hover:bg-[#7B2CBF]">Guardar</button><button onClick={() => setEditLrn(null)} className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl text-xs">Cancelar</button></div></div>) : (<button onClick={() => { setEditLrn(wid); setLrnDraft(pw.learnings); }} className="w-full text-left px-3 py-2 rounded-xl border border-white/5 bg-[#0D0D12] hover:border-white/10">{pw.learnings ? <p className="text-sm text-gray-400">{pw.learnings}</p> : <p className="text-sm text-gray-700 italic">Haz clic para agregar notas...</p>}</button>)}</div>
        </div>)}
      </div>); })}</div></Card>))}
  </div>);
}

function TasksTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const [newTask, setNewTask] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [recurringType, setRecurringType] = useState<TaskRecurringType>("none");
  const [isKey, setIsKey] = useState(false);
  const kDone = s.tasks.filter(t => t.isKey && t.completed).length;

  const add = () => {
    if (!newTask.trim()) return;
    set({
      ...s,
      tasks: [...s.tasks, {
        id: uid(),
        text: newTask.trim(),
        completed: false,
        isKey,
        createdAt: today(),
        recurringType,
        dueDate: dueDate || undefined,
      }],
    });
    setNewTask("");
    setDueDate(today());
    setRecurringType("none");
    setIsKey(false);
  };

  const toggle = (id: string) => set({
    ...s,
    tasks: s.tasks.map(t => t.id === id ? { ...t, completed: !t.completed, completedAt: !t.completed ? today() : undefined } : t),
  });
  const remove = (id: string) => set({ ...s, tasks: s.tasks.filter(t => t.id !== id) });

  const recurringLabel: Record<TaskRecurringType, string> = {
    none: "Sin recurrencia",
    daily: "Diaria",
    weekly: "Semanal",
    monthly: "Mensual",
    annual: "Anual",
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <Card className={`border ${kDone >= 3 ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/5"}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Indicador del Día</p>
            <p className={`text-lg font-bold ${kDone >= 3 ? "text-emerald-400" : "text-white"}`}>{kDone >= 3 ? "✅ 3 Tareas Clave Completadas" : `${kDone} / 3 tareas clave completadas`}</p>
          </div>
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black ${kDone >= 3 ? "bg-emerald-500/20 text-emerald-400" : "bg-[#9D4EDD]/15 text-[#c084fc]"}`}>{kDone}/3</div>
        </div>
        {kDone < 3 && <BarFill value={kDone} max={3} color="#9D4EDD" h={6} />}
      </Card>

      <Card>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Nueva Tarea</p>
        <div className="grid gap-2">
          <div className="flex gap-2">
            <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Escribe una tarea..." className="flex-1 bg-[#0D0D12] border border-white/10 text-white rounded-xl px-4 py-2.5 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
            <button onClick={() => setIsKey(!isKey)} className={`px-3 py-2.5 rounded-xl text-xs font-medium border transition-all ${isKey ? "bg-amber-500/15 border-amber-500/30 text-amber-400" : "bg-white/5 border-white/10 text-gray-500 hover:text-gray-300"}`}>⭐ Clave</button>
            <button onClick={add} className="px-4 py-2.5 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]"><Plus size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60" />
            <select value={recurringType} onChange={e => setRecurringType(e.target.value as TaskRecurringType)} className="bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#9D4EDD]/60">
              <option value="none">Sin recurrencia</option>
              <option value="daily">Diaria</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
              <option value="annual">Anual</option>
            </select>
          </div>
        </div>
      </Card>

      {(() => {
        const sorted = [...s.tasks].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        const pendingKey = sorted.filter(t => t.isKey && !t.completed);
        const pendingNormal = sorted.filter(t => !t.isKey && !t.completed);
        const completed = sorted.filter(t => t.completed);
        const taskCard = (t: Task, icon: "key" | "normal") => (
          <div key={t.id} className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all group ${icon === "key" ? "bg-[#16161F] border-amber-500/15 hover:border-amber-500/25" : "bg-[#16161F] border-white/5 hover:border-white/10"}`}>
            <button onClick={() => toggle(t.id)} className="shrink-0">{t.completed ? <CheckCircle2 size={icon === "key" ? 20 : 18} className="text-emerald-400" /> : <Circle size={icon === "key" ? 20 : 18} className={icon === "key" ? "text-amber-400" : "text-gray-600"} />}</button>
            <div className="flex-1 min-w-0">
              <span className={`block text-sm ${t.completed ? "line-through text-gray-600" : icon === "key" ? "text-gray-100" : "text-gray-300"}`}>{t.text}</span>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                {t.dueDate && <span className="px-1.5 py-0.5 rounded-lg bg-white/5">📅 {t.dueDate}</span>}
                <span className="px-1.5 py-0.5 rounded-lg bg-white/5">🔁 {recurringLabel[t.recurringType || "none"]}</span>
              </div>
            </div>
            <button onClick={() => remove(t.id)} className="text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100"><X size={14} /></button>
          </div>
        );
        return (
          <>
            {pendingKey.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">⭐ Tareas Clave Pendientes</p>
                <div className="space-y-2">{pendingKey.map(t => taskCard(t, "key"))}</div>
              </div>
            )}
            {pendingNormal.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">Tareas Pendientes</p>
                <div className="space-y-2">{pendingNormal.map(t => taskCard(t, "normal"))}</div>
              </div>
            )}
            {completed.length > 0 && (
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-2 px-1">✅ Completadas ({completed.length})</p>
                <div className="space-y-2 opacity-70">{completed.map(t => taskCard(t, "normal"))}</div>
              </div>
            )}
            {s.tasks.length === 0 && (
              <div className="text-center py-12 text-gray-600">
                <CheckSquare size={32} className="mx-auto mb-3 opacity-30" />
                <p>Sin tareas. Agrega la primera arriba.</p>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ userEmail, onLogout, profile, accessToken }: { userEmail: string; onLogout: () => void; profile: UserProfile | null; accessToken?: string; }) {
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [trialDays, setTrialDays] = useState(14);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPass, setNewUserPass] = useState("");
  const [adminUsers, setAdminUsers] = useState<UserProfile[]>([]);
  const [adminAction, setAdminAction] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    if (!profile || profile.role !== "admin" || !accessToken) return;
    api.getUsers(accessToken).then((res) => setAdminUsers(res?.users ?? [])).catch(() => {});
  }, [profile, accessToken]);

  const changePassword = async () => {
    if (!newPass) return;
    if (newPass.length < 6) { setMsg("❌ La contraseña debe tener al menos 6 caracteres."); return; }
    if (newPass !== confirmPass) { setMsg("❌ Las contraseñas no coinciden."); return; }
    setSaving(true); setMsg("");
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setSaving(false);
    if (error) setMsg(`❌ ${error.message}`);
    else { setMsg("✅ Contraseña actualizada correctamente."); setNewPass(""); setConfirmPass(""); }
  };

  const createAdminUser = async () => {
    if (!accessToken) return;
    if (!newUserEmail || !newUserPass) { setAdminAction("Completa email y contraseña."); return; }
    setAdminLoading(true); setAdminAction("");
    try {
      const res = await api.adminCreateUser(accessToken, { email: newUserEmail.trim(), password: newUserPass, trialDays, role: "user" });
      setAdminAction(`Usuario creado. Trial: ${res?.trialDays ?? trialDays} días.`);
      setNewUserEmail(""); setNewUserPass("");
      const updated = await api.getUsers(accessToken);
      setAdminUsers(updated?.users ?? []);
    } catch (e: any) {
      setAdminAction(`❌ ${e.message}`);
    } finally { setAdminLoading(false); }
  };

  const beginStripeCheckout = async () => {
    if (!accessToken) return;
    try {
      const res = await api.createStripeCheckout(accessToken);
      if (res?.checkoutUrl) window.location.href = res.checkoutUrl;
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
        <Card>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">👤 Mi Cuenta</p>
          <div className="bg-[#0D0D12] border border-white/5 rounded-xl p-3 mb-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#9D4EDD]/20 flex items-center justify-center text-sm font-bold text-[#c084fc]">
              {userEmail.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-white">{userEmail}</p>
              <p className="text-xs text-gray-500">{profile?.role === "admin" ? "👑 Administrador" : "👤 Usuario"}</p>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-medium">Cambiar contraseña</p>
            <div className="relative">
              <input type={showPass ? "text" : "password"} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Nueva contraseña"
                className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 pr-10 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
              <button onClick={() => setShowPass(!showPass)} className="absolute right-3 top-3 text-gray-600 hover:text-gray-300">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <input type={showPass ? "text" : "password"} value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Confirmar nueva contraseña"
              className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-700 focus:outline-none focus:border-[#9D4EDD]/60" />
            {msg && <p className={`text-xs px-3 py-2 rounded-xl ${msg.startsWith("✅") ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-red-400 bg-red-500/10 border border-red-500/20"}`}>{msg}</p>}
            <button onClick={changePassword} disabled={saving || !newPass || !confirmPass}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all bg-[#9D4EDD] text-white hover:bg-[#7B2CBF] disabled:opacity-50">
              {saving ? <span className="flex items-center justify-center gap-2"><RefreshCw size={13} className="animate-spin" /> Guardando…</span> : "Cambiar contraseña"}
            </button>
          </div>
          <div className="mt-4 border-t border-white/5 pt-4">
            <p className="text-xs text-gray-500 font-medium mb-2">Suscripción</p>
            <button onClick={beginStripeCheckout} className="w-full py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-black hover:bg-emerald-400">
              Pagar mensual con Stripe
            </button>
          </div>
        </Card>

        {profile?.role === "admin" && (
          <Card>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">🛡️ Admin · Crear usuario con trial</p>
            <div className="space-y-3">
              <input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="Email del usuario" className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm" />
              <input value={newUserPass} onChange={e => setNewUserPass(e.target.value)} placeholder="Contraseña temporal" className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm" />
              <input type="number" min="1" value={trialDays} onChange={e => setTrialDays(Number(e.target.value))} placeholder="Trial en días" className="w-full bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm" />
              <button onClick={createAdminUser} disabled={adminLoading || !accessToken} className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#9D4EDD] text-white hover:bg-[#7B2CBF] disabled:opacity-50">
                {adminLoading ? "Creando…" : "Crear usuario + asignar trial"}
              </button>
              {adminAction && <p className="text-xs px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300">{adminAction}</p>}
              <div className="max-h-40 overflow-auto space-y-2">
                {adminUsers.map((u) => (
                  <div key={u.id} className="rounded-xl bg-[#0D0D12] border border-white/5 p-2.5 text-xs text-gray-300">
                    <div className="font-medium text-white">{u.email}</div>
                    <div className="mt-1 text-gray-500">{u.subscription_status} · {u.trial_days ?? 14} días</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="shrink-0 border-t border-white/5 bg-[#16161F] px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Sesión</p>
        <button onClick={onLogout} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 py-3 text-sm font-medium text-red-400 transition-all hover:bg-red-500/20">
          <LogOut size={15} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

// ─── Activos Tab (dinero en activos) ─────────────────────────────────────────

const ASSET_TYPES: { id: AssetType; label: string; emoji: string; color: string }[] = [
  { id: "cash", label: "Efectivo", emoji: "💵", color: "#10B981" },
  { id: "bank", label: "Cuentas bancarias", emoji: "🏦", color: "#3B82F6" },
  { id: "investment", label: "Inversiones", emoji: "📈", color: "#9D4EDD" },
  { id: "property", label: "Propiedades", emoji: "🏠", color: "#F59E0B" },
  { id: "business", label: "Negocios", emoji: "💼", color: "#06B6D4" },
  { id: "vehicle", label: "Vehículos", emoji: "🚗", color: "#84CC16" },
  { id: "receivable", label: "Por cobrar", emoji: "⏳", color: "#F97316" },
  { id: "other", label: "Otros", emoji: "🗂️", color: "#6b7280" },
];

function AssetsTab({ s, set }: { s: AppState; set: (x: AppState) => void }) {
  const c = s.currency;
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [na, setNa] = useState({ name: "", type: "cash" as AssetType, value: "", notes: "" });
  const assets = s.assets || [];
  const total = assets.reduce((a, x) => a + x.value, 0);
  const byType = ASSET_TYPES.map(t => ({ ...t, items: assets.filter(a => a.type === t.id), subtotal: assets.filter(a => a.type === t.id).reduce((a2, x) => a2 + x.value, 0) })).filter(t => t.subtotal > 0 || t.items.length > 0);
  const potentialFlow = (s.businesses || []).filter(b => b.status !== "ventas").reduce((a, b) => a + b.value, 0);
  const cashLiquid = assets.filter(a => a.type === "cash" || a.type === "bank").reduce((a, x) => a + x.value, 0);
  const cushionMonths = getMonthlyBurn(s) > 0 ? cashLiquid / getMonthlyBurn(s) : 0;

  const startEdit = (a: Asset) => { setEditId(a.id); setNa({ name: a.name, type: a.type, value: String(a.value), notes: a.notes ?? "" }); setShowForm(true); };
  const save = () => {
    if (!na.name.trim()) return;
    const asset: Asset = {
      id: editId || uid(),
      name: na.name.trim(),
      type: na.type,
      value: Math.round(Number(na.value) || 0),
      updatedAt: today(),
      notes: na.notes || undefined,
      createdAt: editId ? (assets.find(a => a.id === editId)?.createdAt ?? today()) : today(),
    };
    set(editId ? { ...s, assets: assets.map(a => a.id === editId ? asset : a) } : { ...s, assets: [...assets, asset] });
    setNa({ name: "", type: "cash", value: "", notes: "" }); setEditId(null); setShowForm(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="relative overflow-hidden">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total de Activos</p>
          <p className="text-3xl font-black text-white">{fmt(total, c)}</p>
          <p className="text-xs text-gray-600 mt-1">Expresados en dinero</p>
        </Card>
        <Card className="relative overflow-hidden">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Líquido (efectivo + bancos)</p>
          <p className="text-3xl font-black text-emerald-400">{fmt(cashLiquid, c)}</p>
          <p className="text-xs text-gray-600 mt-1">Colchón: {cushionMonths.toFixed(1)} meses</p>
        </Card>
        <Card className="relative overflow-hidden">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Flujo potencial (negocios)</p>
          <p className="text-3xl font-black text-[#c084fc]">{fmt(potentialFlow, c)}</p>
          <p className="text-xs text-amber-400/80 mt-1">No es dinero cobrado</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Activos registrados</p>
          <button onClick={() => { setEditId(null); setNa({ name: "", type: "cash", value: "", notes: "" }); setShowForm(!showForm); }} className="flex items-center gap-1.5 text-xs text-[#c084fc] hover:text-[#9D4EDD]"><Plus size={13} /> Agregar activo</button>
        </div>

        {showForm && (
          <div className="bg-[#0D0D12] rounded-xl p-4 border border-white/8 mb-4 space-y-3">
            <input value={na.name} onChange={e => setNa({ ...na, name: e.target.value })} placeholder="Nombre (Ej: Cuenta nómina, Casa Roma, Crypto...)" className="w-full bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm placeholder-gray-700 focus:outline-none" />
            <div className="grid grid-cols-2 gap-2">
              <select value={na.type} onChange={e => setNa({ ...na, type: e.target.value as AssetType })} className="bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm focus:outline-none">
                {ASSET_TYPES.map(t => <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>)}
              </select>
              <input type="number" value={na.value} onChange={e => setNa({ ...na, value: e.target.value })} placeholder={`Valor en ${c} (pesos enteros)`} className="bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm placeholder-gray-700 focus:outline-none" />
            </div>
            <input value={na.notes} onChange={e => setNa({ ...na, notes: e.target.value })} placeholder="Notas (opcional)" className="w-full bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm placeholder-gray-700 focus:outline-none" />
            <div className="flex gap-2">
              <button onClick={save} className="px-3 py-1.5 bg-[#9D4EDD] text-white rounded-xl text-xs hover:bg-[#7B2CBF]">Guardar</button>
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl text-xs">Cancelar</button>
            </div>
          </div>
        )}

        {assets.length === 0 && <p className="text-gray-600 text-sm text-center py-6">Sin activos registrados.</p>}

        <div className="space-y-3">
          {byType.map(t => (
            <div key={t.id} className="rounded-xl border border-white/5 bg-[#0D0D12] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><span>{t.emoji}</span><span className="text-sm font-medium text-white">{t.label}</span></div>
                <span className="text-sm font-bold" style={{ color: t.color }}>{fmt(t.subtotal, c)}</span>
              </div>
              <div className="space-y-1.5">
                {t.items.map(a => (
                  <div key={a.id} className="group flex items-center gap-2 rounded-lg bg-[#16161F]/60 px-2.5 py-1.5">
                    <span className="text-sm text-gray-300 flex-1">{a.name}</span>
                    {a.notes && <span className="text-[10px] text-gray-600 truncate max-w-[160px]">{a.notes}</span>}
                    <span className="text-xs text-gray-400">{a.updatedAt}</span>
                    <span className="text-sm font-semibold text-white">{fmt(a.value, c)}</span>
                    <button onClick={() => startEdit(a)} className="text-gray-600 hover:text-[#c084fc] opacity-0 group-hover:opacity-100"><Pencil size={11} /></button>
                    <button onClick={() => set({ ...s, assets: assets.filter(x => x.id !== a.id) })} className="text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Admin Dashboard (solo admin) ─────────────────────────────────────────────

function AdminDashboard({ accessToken, profile }: { accessToken?: string; profile: UserProfile | null }) {
  const isAdmin = profile?.role === "admin";
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [nuEmail, setNuEmail] = useState("");
  const [nuPass, setNuPass] = useState("");
  const [nuDays, setNuDays] = useState(14);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    Promise.allSettled([
      api.getUsers(accessToken),
      api.adminListIntegrations(accessToken),
      api.adminListSubscriptions(accessToken),
    ]).then(([u, i, sb]) => {
      setUsers((u as any).status === "fulfilled" ? (u as any).value?.users ?? [] : []);
      setIntegrations((i as any).status === "fulfilled" ? (i as any).value?.integrations ?? [] : []);
      setSubscriptions((sb as any).status === "fulfilled" ? (sb as any).value?.subscriptions ?? [] : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isAdmin, accessToken]);

  if (!isAdmin) {
    return <Card><p className="text-sm text-gray-500">No tienes permisos para ver esta sección.</p></Card>;
  }

  const createUser = async () => {
    if (!accessToken || !nuEmail || !nuPass) { setMsg("Completa email y contraseña."); return; }
    setMsg(""); setErr("");
    try {
      const res = await api.adminCreateUser(accessToken, { email: nuEmail.trim(), password: nuPass, trialDays: nuDays });
      setMsg(res?.alreadyExisted ? `El usuario ya existía: se actualizó su trial a ${res.trialDays} días (no se duplicó).` : `Usuario creado con trial de ${res?.trialDays} días.`);
      setNuEmail(""); setNuPass("");
      const u = await api.getUsers(accessToken); setUsers(u?.users ?? []);
    } catch (e: any) { setErr(e.message); }
  };

  const saveIntegration = async (id: string, enabled: boolean) => {
    if (!accessToken) return;
    const it = integrations.find(x => x.id === id);
    try {
      await api.adminSaveIntegration(accessToken, { id, enabled, status: enabled ? "connected" : "disconnected", config: it?.config ?? {} });
      const res = await api.adminListIntegrations(accessToken);
      setIntegrations(res?.integrations ?? []);
    } catch (e: any) { setErr(e.message); }
  };

  const ensureDefaults = async () => {
    if (!accessToken) return;
    for (const id of ["stripe"]) {
      if (!integrations.find(x => x.id === id)) {
        try { await api.adminSaveIntegration(accessToken, { id, enabled: false, status: "disconnected", config: {} }); } catch {}
      }
    }
    const res = await api.adminListIntegrations(accessToken);
    setIntegrations(res?.integrations ?? []);
  };

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-[#9D4EDD]/20 to-[#3B82F6]/10 border border-[#9D4EDD]/20 rounded-2xl p-5 flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-[#9D4EDD]/20 flex items-center justify-center"><ShieldCheck size={24} className="text-[#c084fc]" /></div>
        <div>
          <p className="text-white font-bold text-lg">Dashboard de Administración</p>
          <p className="text-gray-400 text-sm">Gestión de usuarios, trials, suscripciones e integraciones · {profile?.email}</p>
        </div>
      </div>

      {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{err}</p>}
      {msg && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">{msg}</p>}

      {/* Usuarios + trial */}
      <Card>
        <div className="flex items-center gap-2 mb-4"><Users size={15} className="text-[#c084fc]" /><p className="text-xs text-gray-500 uppercase tracking-wider">Gestión de usuarios y trials</p></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          <input value={nuEmail} onChange={e => setNuEmail(e.target.value)} placeholder="Email del usuario" className="bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm" />
          <input value={nuPass} onChange={e => setNuPass(e.target.value)} placeholder="Contraseña temporal" className="bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm" />
          <div className="flex gap-2">
            <input type="number" min="1" value={nuDays} onChange={e => setNuDays(Number(e.target.value))} className="w-24 bg-[#0D0D12] border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm" />
            <button onClick={createUser} className="flex-1 py-2.5 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]">Crear / asignar trial</button>
          </div>
        </div>
        <div className="max-h-64 overflow-auto space-y-2">
          {loading ? <p className="text-gray-600 text-sm">Cargando usuarios…</p> : users.map(u => (
            <div key={u.id} className="rounded-xl bg-[#0D0D12] border border-white/5 p-2.5 text-xs text-gray-300 flex items-center justify-between">
              <div>
                <div className="font-medium text-white">{u.email}</div>
                <div className="mt-1 text-gray-500">{u.role} · {u.subscription_status} · {u.trial_days ?? 14} días · trial hasta {u.trial_end ? new Date(u.trial_end).toLocaleDateString("es-MX") : "—"}</div>
              </div>
              <Bdg color={u.subscription_status === "active" ? "green" : u.subscription_status === "trial" ? "yellow" : "red"}>{u.subscription_status}</Bdg>
            </div>
          ))}
        </div>
      </Card>

      {/* Integraciones */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Plug size={15} className="text-[#c084fc]" /><p className="text-xs text-gray-500 uppercase tracking-wider">Integraciones (Stripe y futuras)</p></div>
          <button onClick={ensureDefaults} className="text-xs text-[#c084fc] hover:text-[#9D4EDD]">Inicializar catálogo</button>
        </div>
        <p className="text-[11px] text-gray-600 mb-3">Los secretos (API keys) NUNCA se guardan aquí ni en el frontend: viven solo en los secretos del Edge Function. Aquí solo se activan/desactivan y se guarda configuración pública.</p>
        <div className="space-y-2">
          {integrations.length === 0 && <p className="text-gray-600 text-sm">Sin integraciones configuradas.</p>}
          {integrations.map(it => (
            <div key={it.id} className="flex items-center gap-3 rounded-xl bg-[#0D0D12] border border-white/5 p-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{it.id === "stripe" ? "💳 Stripe" : it.id}</span>
                  <Bdg color={it.status === "connected" ? "green" : it.status === "error" ? "red" : "gray"}>{it.status}</Bdg>
                </div>
                <p className="text-[11px] text-gray-600 mt-0.5">Estado: {it.enabled ? "Activada (cobros listos cuando se agreguen credenciales en Edge)" : "Desactivada"}</p>
              </div>
              <button onClick={() => saveIntegration(it.id, !it.enabled)} className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${it.enabled ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : "bg-white/5 border-white/10 text-gray-500"}`}>
                {it.enabled ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Suscripciones */}
      <Card>
        <div className="flex items-center gap-2 mb-4"><p className="text-xs text-gray-500 uppercase tracking-wider">Suscripciones</p></div>
        <div className="space-y-2">
          {subscriptions.length === 0 && <p className="text-gray-600 text-sm">Sin suscripciones registradas aún (se llenan vía webhook de Stripe).</p>}
          {subscriptions.map((sb: any) => (
            <div key={sb.id} className="rounded-xl bg-[#0D0D12] border border-white/5 p-2.5 text-xs text-gray-300 flex items-center justify-between">
              <div>
                <div className="font-medium text-white">{sb.plan_id || sb.provider} · {sb.billing_interval || "—"}</div>
                <div className="mt-1 text-gray-500">{sb.status} · next: {sb.current_period_end ? new Date(sb.current_period_end).toLocaleDateString("es-MX") : "—"}</div>
              </div>
              <Bdg color={sb.status === "active" ? "green" : sb.status === "trial" ? "yellow" : "red"}>{sb.status}</Bdg>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

const SK = "momentum90_v1";

const ENTITY_PERSISTENCE: { entity: AppEntityName; key: keyof AppState }[] = [
  { entity: "incomes", key: "incomes" },
  { entity: "expenses", key: "expenses" },
  { entity: "recurringExpenses", key: "recurringExpenses" },
  { entity: "debts", key: "debts" },
  { entity: "goals", key: "goals" },
  { entity: "tasks", key: "tasks" },
  { entity: "businesses", key: "businesses" },
  { entity: "contacts", key: "contacts" },
  { entity: "assets", key: "assets" },
  { entity: "planWeeks", key: "planWeeks" },
  { entity: "habitLogs", key: "habitLogs" },
  { entity: "miniVictories", key: "miniVictories" },
  { entity: "quarterHistory", key: "quarterHistory" },
];

// ─── Pantalla de configuración pendiente (evita la pantalla negra) ───────────

function MissingConfigScreen() {
  return (
    <div className="min-h-screen bg-[#0B0B0E] flex items-center justify-center px-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="w-full max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center mx-auto mb-4">
          <Zap size={26} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Configuración de Supabase pendiente</h1>
        <p className="text-sm text-gray-500 leading-relaxed">
          Faltan las variables <code className="text-[#c084fc]">VITE_SUPABASE_URL</code> y{" "}
          <code className="text-[#c084fc]">VITE_SUPABASE_ANON_KEY</code> en el entorno de esta build.
          <br />
          En Netlify: <span className="text-gray-300">Site settings → Environment variables</span>, agrégalas y
          vuelve a hacer un deploy.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  // Guardia constante: si faltan las variables de Supabase, mostramos un aviso
  // en lugar de quedarnos en negro (nunca lanzamos en el import).
  if (!SUPABASE_CONFIGURED) return <MissingConfigScreen />;

  const [data, setData] = useState<AppState>(INIT);
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [tab, setTab] = useState<AppTab>("dashboard");
  const [showSettings, setShowSettings] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth listener
  useEffect(() => {
    document.documentElement.classList.add("dark");
    // Timeout de seguridad: si Supabase no responde en 8s, muestra login
    const fallback = setTimeout(() => setAuthLoading(false), 8000);
    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(fallback);
      setSession(session);
      if (session?.user?.email) setUserEmail(session.user.email);
      // DIAGNÓSTICO TEMPORAL
      console.log(`[AUTH] getSession → ${session?.user?.id ?? "sin sesión"}`);
      setAuthLoading(false);
    }).catch((e) => { clearTimeout(fallback); console.error("[AUTH] getSession error", e); setAuthLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user?.email) setUserEmail(s.user.email);
      // DIAGNÓSTICO TEMPORAL
      console.log(`[AUTH] onAuthStateChange event=${_e} user=${s?.user?.id ?? "sin sesión"}`);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id || !session?.access_token) {
      setProfile(null);
      return;
    }
    api.getProfile(session.access_token)
      .then((res) => setProfile(res?.profile ?? null))
      .catch(() => setProfile(null));
  }, [session?.user?.id, session?.access_token]);

  // Cargar datos al autenticar desde Supabase como fuente de verdad.
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;

    const loadFromSupabase = async () => {
      const token = session?.access_token;
      if (!token) return;
      const uid = session?.user?.id;
      // DIAGNÓSTICO TEMPORAL
      console.log(`[LOAD_START] user=${uid} table=app_data,user_entities op=GET`);
      try {
        const response = await api.getData(token);
        const remoteData = response?.data;
        console.log(`[LOAD_OK app_data] user=${uid} op=GET → data=${remoteData && typeof remoteData === "object" ? "presente" : "null/vacío"}`);
        const entityResults = await Promise.all(ENTITY_PERSISTENCE.map(async ({ entity, key }) => {
          try {
            const result = await api.getEntity(token, entity);
            const items = Array.isArray(result?.items) ? result.items : [];
            console.log(`[LOAD_OK user_entities] user=${uid} entity=${entity} op=GET → ${items.length} items`);
            return [key, items] as const;
          } catch (e) {
            // DIAGNÓSTICO TEMPORAL
            console.error(`[LOAD_ERROR] user=${uid} table=user_entities(${entity}) op=GET`, e);
            return [key, null] as const;
          }
        }));

        const mergedEntities = entityResults.reduce((acc, [key, items]) => {
          if (Array.isArray(items)) acc[key] = items as never;
          return acc;
        }, {} as Partial<AppState>);

        const rebuiltState = reconcileRemoteState(remoteData, mergedEntities);
        if (!cancelled) setData(rebuiltState);
        // DIAGNÓSTICO TEMPORAL
        console.log(`[LOAD_SUCCESS] user=${uid} tables=app_data+user_entities op=GET → ${Object.keys(mergedEntities).length} entidades`);
        return;
      } catch (e) {
        // La nube debe ser la fuente de verdad; aquí no se usa cache local como fallback.
        // DIAGNÓSTICO TEMPORAL
        console.error(`[LOAD_ERROR] user=${uid} table=app_data op=GET`, e);
      }
    };

    loadFromSupabase();
    return () => { cancelled = true; };
  }, [session?.user?.id, session?.access_token]);

  // Auto-guardar datos en Supabase cuando hay sesión activa.
  useEffect(() => {
    if (!session?.user?.id || !session?.access_token) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const uid = session?.user?.id;
      // DIAGNÓSTICO TEMPORAL
      console.log(`[SAVE_START] user=${uid} table=app_data+user_entities op=UPSERT(POST)`);
      try {
        await api.saveData(session.access_token, data);
        // Sólo se confirma el guardado tras respuesta exitosa de Supabase.
        console.log(`[SAVE_SUCCESS] user=${uid} table=app_data op=UPSERT(POST) OK`);
        for (const { entity, key } of ENTITY_PERSISTENCE) {
          const items = data[key] as unknown[] | undefined;
          if (!Array.isArray(items)) continue;
          try {
            await api.saveEntity(session.access_token, entity, items);
            console.log(`[SAVE_SUCCESS] user=${uid} table=user_entities(${entity}) op=UPSERT(POST) items=${items.length}`);
          } catch (e) {
            // DIAGNÓSTICO TEMPORAL
            console.error(`[SAVE_ERROR] user=${uid} table=user_entities(${entity}) op=UPSERT(POST)`, e);
          }
        }
      } catch (e) {
        // La nube no debe romper la experiencia si falla una sincronización puntual.
        // DIAGNÓSTICO TEMPORAL
        console.error(`[SAVE_ERROR] user=${uid} table=app_data op=UPSERT(POST)`, e);
      }
    }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [data, session?.user?.id, session?.access_token]);

  // Migración única: importar datos legacy de localStorage hacia Supabase.
  // Solo corre si la nube está vacía; NO borra la copia local (fuente queda intacta).
  useEffect(() => {
    if (!session?.user?.id || !session?.access_token) return;
    (async () => {
      try {
        const response = await api.getData(session.access_token);
        const remote = response?.data;
        if (remote && typeof remote === "object" && Object.keys(remote).length > 0) return;
        const legacyKeys = [`${SK}_${session.user.id}`, "momentum90_v1", "momentum90_state"];
        for (const k of legacyKeys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          let parsed: any;
          try { parsed = JSON.parse(raw); } catch { continue; }
          if (!parsed || typeof parsed !== "object") continue;
          await api.saveData(session.access_token, parsed);
          const migrated = mergeSavedState(parsed);
          setData(migrated);
          // Se mantiene la clave local intacta para no perder nada hasta verificar.
          break;
        }
      } catch {
        // Migración best-effort: nunca debe romper el login ni la carga normal.
      }
    })();
  }, [session?.user?.id, session?.access_token]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null); setData(INIT);
  };

  // Pantalla de carga
  if (authLoading) return (
    <div className="min-h-screen bg-[#0B0B0E] flex items-center justify-center" style={{ fontFamily: "'Inter',sans-serif" }}>
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center mx-auto mb-4 animate-pulse">
          <Zap size={22} className="text-white" />
        </div>
        <p className="text-gray-500 text-sm">Cargando Momentum 90…</p>
      </div>
    </div>
  );

  const isRecoveryRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/auth/reset");

  // Ruta de recuperación: muestra la pantalla de cambio de contraseña siempre,
  // con la sesión de recuperación o un aviso de enlace expirado/inválido.
  if (isRecoveryRoute) return <ResetPasswordScreen hasSession={!!session} />;

  // Pantalla de login/registro
  if (!session) return <AuthScreen />;


  const keyDone = data.tasks.filter(t => t.isKey && t.completed).length;
  const hotProps = (data.businesses || []).filter(b => b.status === "marketing" || b.status === "ventas").length + (data.contacts || []).filter(c => c.status === "cita" || c.status === "apartado" || c.status === "cierre").length;
  const completedGoals = data.goals.filter(g => g.status === "completed").length;

  const TABS: { id: AppTab; label: string; short: string; icon: ReactNode; badge?: number }[] = [
    { id: "dashboard", label: "Dashboard CEO", short: "CEO", icon: <LayoutDashboard size={16} /> },
    { id: "money", label: "Motor de Dinero", short: "Dinero", icon: <Zap size={16} /> },
    { id: "capital", label: "Capital & Metas", short: "Capital", icon: <Target size={16} /> },
    { id: "activos", label: "Activos", short: "Activos", icon: <Wallet size={16} /> },
    { id: "plan", label: "Plan Trimestral", short: "Plan", icon: <Calendar size={16} /> },
    { id: "tasks", label: "Tareas", short: "Tareas", icon: <CheckSquare size={16} />, badge: keyDone < 3 ? keyDone : undefined },
    { id: "crm", label: "CRM", short: "CRM", icon: <Building2 size={16} />, badge: hotProps || undefined },
    { id: "logros", label: "Logros & Victorias", short: "Logros", icon: <Trophy size={16} />, badge: completedGoals || undefined },
    ...(profile?.role === "admin" ? [{ id: "admin" as AppTab, label: "Admin", short: "Admin", icon: <ShieldCheck size={16} /> }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0B0B0E] text-white" style={{ fontFamily: "'Inter', sans-serif" }}>
      {showSettings && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex justify-end">
          <div className="flex h-dvh min-h-0 w-full flex-col bg-[#16161F] border-l border-white/10 shadow-2xl sm:w-80">
            <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-4">
              <p className="text-white font-bold">Configuración</p>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white" aria-label="Cerrar configuración"><X size={16} /></button>
            </div>
            <SettingsPanel userEmail={userEmail} onLogout={handleLogout} profile={profile} accessToken={session?.access_token} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col fixed top-0 left-0 h-screen w-56 bg-[#0D0D12] border-r border-white/5 z-40 p-4">
        <div className="flex items-center gap-2.5 mb-8 px-1">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center shrink-0"><Zap size={15} className="text-white" /></div>
          <div><p className="text-white font-bold text-sm leading-tight">Momentum</p><p className="text-[#9D4EDD] text-xs font-semibold tracking-widest">90</p></div>
        </div>
        <nav className="flex-1 space-y-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === t.id ? "bg-[#9D4EDD]/15 text-[#c084fc] border border-[#9D4EDD]/25" : "text-gray-500 hover:text-gray-200 hover:bg-white/5"}`}>
              {t.icon} {t.label}
              {t.badge !== undefined && <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">{t.badge}</span>}
              {t.id === "crm" && hotProps > 0 && tab !== "crm" && <span className="ml-auto text-[10px] bg-[#9D4EDD]/20 text-[#c084fc] border border-[#9D4EDD]/20 px-1.5 py-0.5 rounded-full">{hotProps}</span>}
            </button>
          ))}
        </nav>
        <div className="pt-4 border-t border-white/5 space-y-2">
          <button onClick={() => setShowSettings(!showSettings)} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-gray-600 hover:text-gray-300 hover:bg-white/5 text-xs transition-all"><Settings size={13} /> Configuración</button>
          <p className="text-[10px] text-gray-700 px-1">Momentum90 · Q{getQ()} {getQYear()} · Día {dayOfQNow()}/{getQTotalDays(getQ(), getQYear())}</p>
        </div>
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-40 bg-[#0B0B0E]/85 backdrop-blur-xl border-b border-white/5">
          <div className="flex items-center justify-between px-5 py-3.5 max-w-6xl mx-auto">
            <div className="lg:hidden flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center"><Zap size={13} className="text-white" /></div>
              <span className="text-white font-bold text-sm">Momentum<span className="text-[#9D4EDD]">90</span></span>
            </div>
            <div className="hidden lg:block">
              <h1 className="text-base font-bold text-white">{TABS.find(t => t.id === tab)?.label}</h1>
              <p className="text-xs text-gray-600">{new Date().toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-1.5 bg-[#9D4EDD]/10 border border-[#9D4EDD]/20 px-3 py-1.5 rounded-xl">
                <span className="text-[#c084fc] text-xs font-semibold font-mono">Q{getQ()} · Día {dayOfQNow()}/{getQTotalDays(getQ(), getQYear())}</span>
              </div>
              <button onClick={() => setShowSettings(!showSettings)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all lg:hidden"><Settings size={15} /></button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 md:px-5 py-6 pb-28 lg:pb-8">
          {tab === "dashboard" && <DashboardTab s={data} set={setData} />}
          {tab === "money" && <MoneyTab s={data} set={setData} />}
          {tab === "capital" && <CapitalTab s={data} set={setData} />}
          {tab === "activos" && <AssetsTab s={data} set={setData} />}
          {tab === "plan" && <PlanTab s={data} set={setData} />}
          {tab === "tasks" && <TasksTab s={data} set={setData} />}
          {tab === "crm" && <CRMTab s={data} set={setData} />}
          {tab === "logros" && <LogrosTab s={data} set={setData} />}
          {tab === "admin" && profile?.role === "admin" && <AdminDashboard accessToken={session?.access_token} profile={profile} />}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0D0D12]/95 backdrop-blur-xl border-t border-white/5">
        <div className="flex items-center overflow-x-auto px-1 py-1.5 gap-1 scrollbar-hide">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all relative shrink-0 ${tab === t.id ? "text-[#c084fc] bg-[#9D4EDD]/10" : "text-gray-600 hover:text-gray-400"}`}>
              {t.icon}
              <span className="text-[9px] font-medium">{t.short}</span>
              {t.id === "tasks" && keyDone < 3 && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full text-[7px] text-black font-black flex items-center justify-center">{keyDone}</div>}
              {t.id === "crm" && hotProps > 0 && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[#9D4EDD] rounded-full text-[7px] text-white font-black flex items-center justify-center">{hotProps}</div>}
              {t.id === "logros" && completedGoals > 0 && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full text-[7px] text-white font-black flex items-center justify-center">{completedGoals}</div>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
