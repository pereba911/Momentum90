import VoiceRecorder from "../components/VoiceRecorder";
import { type AIExtraction, type UserContext } from "../utils/extractWithAI";

// Helpers locales (mismo formato que usa la app: ids base36 de 6 chars y fecha YYYY-MM-DD local).
function uid(): string { return Math.random().toString(36).slice(2, 8); }
function today(): string { return new Date().toLocaleDateString("en-CA"); }

interface QuickData {
  currency: string;
  incomes: { source?: string }[];
  expenses: { category: string }[];
  debts: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  businesses: { id: string; name: string }[];
}

export default function QuickRecordPage({ data, accessToken, embedded, onMutateIncomes, onMutateExpenses, onMutateDebts, onMutateDebtPayment, onGoTo }: {
  data: QuickData;
  accessToken?: string;
  embedded?: boolean; // true cuando se muestra dentro del bottom-sheet global
  onMutateIncomes: (u: (prev: any[]) => any[]) => Promise<boolean>;
  onMutateExpenses: (u: (prev: any[]) => any[]) => Promise<boolean>;
  onMutateDebts: (u: (prev: any[]) => any[]) => Promise<boolean>;
  onMutateDebtPayment: (debtId: string, amount: number, date: string, note?: string) => Promise<boolean>;
  onGoTo: (tab: string) => void;
}) {
  const userContext: UserContext = {
    categories: Array.from(new Set([
      ...(data.expenses || []).map(e => e.category).filter(Boolean),
      ...(data.incomes || []).map(i => i.source).filter(Boolean),
    ])),
    activeDebts: (data.debts || []).map(d => ({ name: d.name, id: d.id })),
    contacts: (data.contacts || []).map(c => ({ name: c.name, id: c.id })),
    businesses: (data.businesses || []).map(b => ({ name: b.name, id: b.id })),
    primaryCurrency: data.currency || "MXN",
    today: today(),
  };

  // Guarda SOLO tras confirmación explícita del usuario en la bandeja de revisión.
  const handleSave = async (extraction: AIExtraction): Promise<boolean> => {
    const ops = extraction.operations || [];
    const incomeOps = ops.filter(o => o.type === "income");
    const expenseOps = ops.filter(o => o.type === "expense");
    const debtOps = ops.filter(o => o.type === "debt_payment" || o.type === "debt_creation");

    if (incomeOps.length > 0) {
      const ok = await onMutateIncomes(prev => [
        ...prev,
        ...incomeOps.map(o => ({
          id: uid(),
          date: o.date || today(),
          type: o.category || "Otro",
          description: o.notes || o.merchant_or_contact || "Ingreso por voz",
          amount: Math.round(o.amount!),
          status: "Cobrado",
          source: o.category || "Otro",
          totalAmount: Math.round(o.amount!),
          amountCollected: Math.round(o.amount!),
          paymentHistory: [{ id: uid(), date: o.date || today(), amount: Math.round(o.amount!), note: "Registro por voz" }],
          notes: o.notes || "Registro por voz",
          recordSource: "voice",
        })),
      ]);
      if (!ok) return false;
    }

    if (expenseOps.length > 0) {
      const ok = await onMutateExpenses(prev => [
        ...prev,
        ...expenseOps.map(o => ({
          id: uid(),
          date: o.date || today(),
          category: o.category || "Otros",
          businessCategory: "",
          description: o.notes || o.merchant_or_contact || "Gasto por voz",
          amount: Math.round(o.amount!),
          recordSource: "voice",
        })),
      ]);
      if (!ok) return false;
    }

    for (const o of debtOps) {
      const nameHint = extraction.matched_debt || o.merchant_or_contact || "";
      const match = nameHint ? userContext.activeDebts.find(d => d.name.toLowerCase() === nameHint.toLowerCase()) : undefined;
      if (o.type === "debt_payment" && match) {
        const ok = await onMutateDebtPayment(match.id, Math.round(o.amount!), o.date || today(), o.notes || "Abono por voz");
        if (!ok) return false;
      } else {
        const ok = await onMutateDebts(prev => [
          ...prev,
          {
            id: uid(),
            name: nameHint || "Deuda por voz",
            balance: Math.round(o.amount!),
            minPayment: 0,
            targetPayment: 0,
            originalBalance: Math.round(o.amount!),
            targetDate: o.date || today(),
            category: o.category,
            notes: o.notes || "Registro por voz",
            payments: [],
            amountPaid: 0,
            status: "Pendiente",
            recordSource: "voice",
          },
        ]);
        if (!ok) return false;
      }
    }

    return true;
  };

  return (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <h2 className="text-lg font-bold text-white">Registro rápido por voz</h2>
          <p className="text-sm text-gray-500">Graba una frase; la IA extrae ingresos, gastos o abonos y tú apruebas antes de guardar. <span className="text-gray-400">Nada se guarda sin tu confirmación.</span></p>
        </div>
      )}
      <VoiceRecorder userContext={userContext} accessToken={accessToken} onSave={handleSave} onDone={() => onGoTo("dashboard")} />
    </div>
  );
}
