// ─────────────────────────────────────────────────────────────────────────────
// Reporte PDF de Gastos — Momentum90
// Generación 100% en el navegador con jsPDF (sin subir archivos, sin Storage,
// sin carpeta pública de Netlify). Solo se usa la información del usuario
// autenticado que llama a la función. Descarga directa del archivo.
// ─────────────────────────────────────────────────────────────────────────────
import { jsPDF } from "jspdf";

export interface ReportExpense {
  id: string;
  date: string; // YYYY-MM-DD
  category: string;
  businessCategory?: string;
  description: string;
  amount: number;
  recurring?: boolean;
}
export interface ReportRecurring {
  id: string;
  description: string;
  category: string;
  amount: number;
  active: boolean;
}
export interface ExpenseReportInput {
  currency: string;
  expenses: ReportExpense[];
  recurringExpenses?: ReportRecurring[];
  from: string; // YYYY-MM-DD (inclusive)
  to: string;   // YYYY-MM-DD (inclusive)
  label: string; // "Semana", "Mes", "Trimestre", "Personalizado"
}
export interface ExpenseReportResult {
  filename: string;
  total: number;
  nExpenses: number;
  generatedAt: string;
}

const DISCLAIMER =
  "Este reporte es informativo y no constituye asesoría financiera profesional.";

function money(n: number, currency: string): string {
  const sym = currency === "USD" ? "US$" : currency === "EUR" ? "€" : "$";
  const v = Math.round(n);
  return `${sym}${v.toLocaleString("es-MX")}`;
}
function pctLabel(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}
function addSection(doc: jsPDF, title: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(157, 78, 221);
  doc.text(title, 14, y);
  doc.setDrawColor(157, 78, 221, 40);
  doc.line(14, y + 1.5, 196, y + 1.5);
  return y + 6;
}
function addLine(doc: jsPDF, label: string, value: string, y: number, opts: { bold?: boolean; color?: [number, number, number] } = {}): number {
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  doc.setFontSize(10);
  doc.setTextColor(opts.color ? opts.color[0] : 60, opts.color ? opts.color[1] : 60, opts.color ? opts.color[2] : 60);
  const right = doc.getTextWidth(value);
  doc.text(label, 14, y);
  doc.text(value, 196 - right, y);
  return y + 5;
}
function addWrapped(doc: jsPDF, text: string, y: number, size = 9, color: [number, number, number] = [120, 120, 120]): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
  const lines = doc.splitTextToSize(text, 178);
  doc.text(lines, 14, y);
  return y + lines.length * (size * 0.45) + 2;
}

export function buildExpenseReportPdf(input: ExpenseReportInput): ExpenseReportResult {
  const { currency, from, to, label } = input;
  const inRange = (date: string) => date >= from && date <= to;

  const period = input.expenses.filter((e) => inRange(e.date));
  const total = period.reduce((a, e) => a + e.amount, 0);
  const recurringDescs = new Set((input.recurringExpenses || []).map((r) => r.description));
  const isFixed = (e: ReportExpense) => e.recurring || recurringDescs.has(e.description);
  const fixed = period.filter(isFixed).reduce((a, e) => a + e.amount, 0);
  const variable = total - fixed;

  const byCat: Record<string, number> = {};
  period.forEach((e) => {
    const k = e.category || "Sin categoría";
    byCat[k] = (byCat[k] || 0) + e.amount;
  });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  // Periodo anterior con la misma duración.
  const durMs = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const prevTo = new Date(new Date(from).getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - durMs);
  const pad = (x: number) => String(x).padStart(2, "0");
  const prevFromS = `${prevFrom.getFullYear()}-${pad(prevFrom.getMonth() + 1)}-${pad(prevFrom.getDate())}`;
  const prevToS = `${prevTo.getFullYear()}-${pad(prevTo.getMonth() + 1)}-${pad(prevTo.getDate())}`;
  const prevPeriod = input.expenses.filter((e) => e.date >= prevFromS && e.date <= prevToS);
  const prevTotal = prevPeriod.reduce((a, e) => a + e.amount, 0);
  const pctChange = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(); // 210
  const pageH = doc.internal.pageSize.getHeight(); // 297
  let y = 20;

  // Encabezado
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 15, 20);
  doc.text("Reporte de Gastos — Momentum90", 14, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 95);
  doc.text(`Periodo: ${label} (${from} → ${to})`, 14, y);
  y += 5;
  doc.text(`Generado el ${new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}`, 14, y);
  y += 6;

  if (period.length === 0) {
    y = addWrapped(doc, "No hay suficientes datos de gastos en el periodo seleccionado. Este reporte se genera únicamente con los gastos registrados; no se incluyen cifras inventadas.", y, 11, [60, 60, 65]);
    y += 6;
    y = addWrapped(doc, DISCLAIMER, y);
    const filename = `reporte-gastos-${from}.pdf`;
    doc.save(filename);
    return { filename, total: 0, nExpenses: 0, generatedAt: new Date().toISOString() };
  }

  // Resumen
  y = addSection(doc, "Resumen", y);
  y = addLine(doc, "Total de gastos", money(total, currency), y, { bold: true, color: [180, 40, 40] });
  y = addLine(doc, "Gastos fijos", money(fixed, currency), y);
  y = addLine(doc, "Gastos variables", money(variable, currency), y);
  y += 2;

  // Comparación con periodo anterior
  y = addSection(doc, "Comparación con el periodo anterior", y);
  y = addLine(doc, `Periodo anterior (${prevFromS} → ${prevToS})`, money(prevTotal, currency), y);
  if (pctChange != null) {
    const up = pctChange > 0;
    y = addLine(doc, "Cambio", `${up ? "+" : ""}${pctChange.toFixed(1)}%`, y, { color: up ? [180, 40, 40] : [16, 150, 90] });
  } else {
    y = addWrapped(doc, "No hay datos suficientes del periodo anterior para comparar.", y);
  }
  y += 2;

  // Por categoría
  y = addSection(doc, "Gastos por categoría", y);
  if (cats.length === 0) {
    y = addWrapped(doc, "Sin categorías registradas.", y);
  } else {
    cats.slice(0, 10).forEach(([name, val]) => {
      y = addLine(doc, `${name}`, money(val, currency), y);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 155);
      doc.text(pctLabel(val, total), 196 - doc.getTextWidth(pctLabel(val, total)), y - 1);
    });
    if (cats.length > 10) {
      y = addWrapped(doc, `Y ${cats.length - 10} categoría(s) más no mostradas.`, y);
    }
  }
  y += 2;

  // Tendencia
  y = addSection(doc, "Tendencias", y);
  const days = Math.max(1, Math.round(durMs / 86400000) + 1);
  const avgPerDay = total / days;
  y = addWrapped(doc, `Gasto promedio del periodo: ${money(avgPerDay, currency)} por día (${days} día(s) analizados).`, y);
  y += 2;

  // Recomendaciones (educativas y neutrales)
  y = addSection(doc, "Recomendaciones", y);
  const recs: string[] = [];
  if (cats.length > 0) {
    const [topName, topVal] = cats[0];
    recs.push(`La categoría "${topName}" representa el ${pctLabel(topVal, total)} de tus gastos del periodo. Podrías revisar si se ajusta a tus prioridades.`);
  }
  if (variable > 0) {
    recs.push(`Los gastos variables representan el ${pctLabel(variable, total)} del total. Considera evaluar los rubros variables de forma periódica.`);
  }
  if (pctChange != null && pctChange > 5) {
    recs.push(`El total creció ${pctChange.toFixed(1)}% respecto al periodo anterior. Podrías revisar qué partidas impulsaron ese cambio.`);
  }
  const recActivos = (input.recurringExpenses || []).filter((r) => r.active && r.amount > 0).sort((a, b) => b.amount - a.amount);
  if (recActivos.length > 0) {
    const r = recActivos[0];
    recs.push(`El gasto recurrente "${r.description}" (${money(r.amount, currency)}/mes) es uno de los más altos. Considera evaluarlo periódicamente.`);
  }
  if (recs.length === 0) {
    recs.push("Con los datos actuales no hay recomendaciones específicas. Sigue registrando tus gastos para obtener más señales.");
  }
  recs.forEach((r) => {
    y = addWrapped(doc, `• ${r}`, y);
  });
  y += 3;

  // Aclaración
  y = addWrapped(doc, DISCLAIMER, y, 8.5, [130, 130, 135]);

  // Pie de página (solo datos del usuario actual; nada de otros usuarios)
  const nPages = doc.getNumberOfPages();
  for (let p = 1; p <= nPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 165);
    doc.text(`Momentum90 · Reporte de gastos generado localmente · ${new Date().toISOString().slice(0, 10)}`, 14, pageH - 10);
    doc.text(`Página ${p} de ${nPages}`, pageW - 14, pageH - 10, { align: "right" });
  }

  const filename = `reporte-gastos-${from}.pdf`;
  doc.save(filename); // descarga directa; no se sube ni se comparte
  return { filename, total, nExpenses: period.length, generatedAt: new Date().toISOString() };
}
