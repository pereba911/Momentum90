import { useEffect, useRef, useState } from "react";
import {
  Mic, Square, Loader2, AlertTriangle, CheckCircle2, RotateCcw, X, Wand2, FileText, Sparkles,
} from "lucide-react";
import { isSpeechSupported, startSpeechRecognition, SPEECH_ERROR_MESSAGES, type ActiveRecognition, type SpeechStatus } from "../utils/speechToText";
import { extractWithAI, type AIExtraction, type AIOperation, type UserContext } from "../utils/extractWithAI";
import { validateExtraction, aiOpCashEffect, type ValidationResult } from "../utils/validateExtraction";

const MAX_SECONDS = 10;
const TYPE_META: Record<string, { label: string; cls: string }> = {
  income: { label: "💵 Ingreso", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
  income_payment: { label: "💵 Cobro de ingreso", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
  expense: { label: "💸 Gasto", cls: "bg-red-500/10 text-red-400 border-red-500/25" },
  debt_payment: { label: "💳 Abono a deuda", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25" },
  debt_creation: { label: "💳 Nueva deuda", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25" },
  commitment: { label: "📌 Compromiso", cls: "bg-sky-500/10 text-sky-400 border-sky-500/25" },
  asset: { label: "🏦 Activo", cls: "bg-violet-500/10 text-violet-400 border-violet-500/25" },
  transfer: { label: "🔁 Transferencia", cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/25" },
  unknown: { label: "❓ Sin clasificar", cls: "bg-white/5 text-gray-400 border-white/10" },
};

export default function VoiceRecorder({ userContext, accessToken, onSave, onCancel, onDone }: {
  userContext: UserContext;
  accessToken?: string;
  onSave: (extraction: AIExtraction) => Promise<boolean>;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const isRecording = status === "listening" || status === "requesting_permission";
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState("");
  const [transcribed, setTranscribed] = useState("");
  const [manualText, setManualText] = useState("");
  const [extraction, setExtraction] = useState<AIExtraction | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const recRef = useRef<ActiveRecognition | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTicker = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  const stopActive = () => { try { recRef.current?.abort(); } catch { /* noop */ } recRef.current = null; };

  // Limpieza segura al desmontar: nunca dejar el micrófono activo ni la UI congelada.
  useEffect(() => () => { clearTicker(); stopActive(); }, []);

  const reset = () => {
    clearTicker(); stopActive();
    setStatus("idle"); setSeconds(0); setInterim(""); setTranscribed(""); setManualText("");
    setExtraction(null); setValidation(null); setError(null); setInfo(null); setSaved(false);
  };

  const startRecording = () => {
    // Guard: nunca dos starts en la misma sesión ni mientras se procesa/guarda.
    if (isRecording || status === "processing" || isLoading || saving) return;
    if (!isSpeechSupported()) {
      setStatus("error");
      setError(SPEECH_ERROR_MESSAGES["not-supported"]);
      return;
    }
    setError(null); setInfo(null); setSaved(false);
    setTranscribed(""); setInterim(""); setManualText(""); setSeconds(0);
    setExtraction(null); setValidation(null);

    const t0 = Date.now();
    tickRef.current = setInterval(() => {
      setSeconds(Math.min(Math.floor((Date.now() - t0) / 1000), MAX_SECONDS));
    }, 400);

    const active = startSpeechRecognition({
      onStatusChange: (st) => { setStatus(st); if (st === "idle" || st === "error") clearTicker(); },
      onResult: (it, fin) => { setInterim(it); setTranscribed(fin); },
      onError: (_code, msg) => { clearTicker(); setStatus("idle"); setError(msg); },
      onEnd: () => { clearTicker(); setStatus("idle"); },
    }, { maxSeconds: MAX_SECONDS });

    recRef.current = active;
  };

  const stopRecording = () => {
    // Detención suave: conserva la transcripción; onend vuelve a idle.
    try { recRef.current?.stop(); } catch { /* noop */ }
    clearTicker();
  };

  const runExtraction = async (text?: string) => {
    const t = (text ?? manualText ?? transcribed).trim();
    if (!t) { setError("No hay texto transcrito. Graba o escribe el texto manualmente."); return; }
    setIsLoading(true); setStatus("processing"); setError(null); setInfo(null);
    try {
      const ex = await extractWithAI(t, userContext, accessToken || "");
      setExtraction(ex);
      setValidation(validateExtraction(ex, userContext));
      setInfo("Extracción completada. Revisa la bandeja antes de guardar.");
    } catch (e) {
      // Conservar el texto: el usuario puede reintentar sin volver a escribir.
      setExtraction(null); setValidation(null);
      setError(e instanceof Error ? e.message : "Error al extraer con IA.");
    } finally {
      setIsLoading(false); setStatus("idle");
    }
  };

  // Ejemplo de prueba (sin llamar a la IA) para validar el flujo en desarrollo.
  const loadSample = () => {
    setError(null); setInfo(null); setSaved(false);
    const sample: AIExtraction = {
      operations: [
        { type: "income", amount: 2500, currency: userContext.primaryCurrency, date: userContext.today, category: "Consultoría", merchant_or_contact: null, notes: "Pago de consultoría (ejemplo)", confidence: 0.9, ambiguities: [] },
        { type: "expense", amount: 350, currency: userContext.primaryCurrency, date: userContext.today, category: "Transporte", merchant_or_contact: "Gasolinera", notes: "Gasolina (ejemplo)", confidence: 0.95, ambiguities: [] },
      ],
      explanation: `Ejemplo de prueba: un ingreso de 2500 ${userContext.primaryCurrency} por consultoría y un gasto de 350 ${userContext.primaryCurrency} de gasolina.`,
      suggested_category: null,
      matched_debt: null,
      matched_contact: null,
      source: "voice",
    };
    setTranscribed("Recibí 2500 por consultoría y pagué 350 de gasolina (ejemplo)");
    setManualText("");
    setExtraction(sample);
    setValidation(validateExtraction(sample, userContext));
    setInfo("Ejemplo de prueba cargado (no se llamó a la IA).");
  };

  const handleSave = async () => {
    if (!extraction || !validation?.canProceed || saving) return;
    setSaving(true); setError(null);
    try {
      const ok = await onSave(extraction);
      if (ok) { setSaved(true); setInfo("Guardado correctamente. El dashboard se actualizó."); }
      else setError("No se pudo guardar. Revisa la conexión e inténtalo de nuevo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const typeMeta = (t: string) => TYPE_META[t] || { label: t || "?" , cls: "bg-white/5 text-gray-400 border-white/10" };

  return (
    <div className="space-y-4">
      {/* Estado de éxito */}
      {saved ? (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-6 text-center space-y-3">
          <CheckCircle2 size={40} className="mx-auto text-emerald-400" />
          <p className="text-white font-semibold">¡Guardado! 🎉</p>
          <p className="text-sm text-gray-400">Las operaciones se guardaron y el dashboard ya se actualizó.</p>
          <div className="flex justify-center gap-2 flex-wrap">
            <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF]"><RotateCcw size={14} /> Registrar otro</button>
            {onDone && <button onClick={onDone} className="px-4 py-2 bg-white/5 text-gray-300 rounded-xl text-sm hover:bg-white/10">Ir al dashboard</button>}
          </div>
        </div>
      ) : (
        <>
          {/* Botón de micrófono */}
          <div className="flex flex-col items-center gap-2 py-4">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={status === "processing" || isLoading || saving}
              className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all disabled:opacity-60 ${
                isRecording ? "bg-red-500/20 border-2 border-red-500 animate-pulse" : "bg-[#9D4EDD]/15 border-2 border-[#9D4EDD]/40 hover:bg-[#9D4EDD]/25"
              }`}
              aria-label={isRecording ? "Detener grabación" : "Grabar por voz"}
            >
              {isRecording ? <Square size={28} className="text-red-400" /> : <Mic size={30} className="text-[#c084fc]" />}
            </button>
            <p className="text-xs text-gray-500 min-h-[16px]">
              {status === "requesting_permission" ? "Solicitando permiso del micrófono…"
                : status === "listening" ? `Grabando… ${seconds}/${MAX_SECONDS}s`
                : status === "processing" ? "Procesando…"
                : `Toca el micrófono para grabar (máx. ${MAX_SECONDS}s)`}
            </p>
            {isRecording && (
              <button onClick={stopRecording} className="flex items-center gap-1.5 px-4 py-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-xl text-xs font-medium hover:bg-red-500/25 min-h-11" aria-label="Detener grabación">
                <Square size={13} /> Detener grabación
              </button>
            )}
            {isSpeechSupported() ? (
              <p className="text-[11px] text-gray-600">Habla en español. Verás el texto mientras grabas.</p>
            ) : (
              <p className="text-[11px] text-amber-400/80">Este navegador no soporta reconocimiento de voz; escribe el texto manualmente.</p>
            )}
          </div>

          {/* Texto transcrito */}
          <div className="bg-[#0D0D12] border border-white/8 rounded-xl p-4 min-h-[72px]">
            <div className="flex items-center gap-2 mb-1.5">
              <FileText size={13} className="text-gray-500" />
              <p className="text-xs text-gray-500 uppercase tracking-wider">Texto transcrito</p>
            </div>
            <p className="text-sm text-white whitespace-pre-wrap">{transcribed || <span className="text-gray-600 italic">Sin texto todavía…</span>}</p>
            {interim && <p className="text-xs text-gray-500 mt-1 italic">{interim}…</p>}
            <textarea
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              placeholder="O escribe aquí el texto si no puedes grabar…"
              className="w-full mt-2 bg-[#16161F] border border-white/10 text-white rounded-xl px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-[#9D4EDD]/50 min-h-[54px] resize-none"
            />
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runExtraction()}
              disabled={isLoading || saving || (!transcribed.trim() && !manualText.trim())}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#9D4EDD] text-white rounded-xl text-sm font-medium hover:bg-[#7B2CBF] disabled:opacity-50"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isLoading ? "Extrayendo…" : "Extraer información"}
            </button>
            <button onClick={loadSample} disabled={isLoading || saving} className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 text-gray-300 rounded-xl text-xs hover:bg-white/10 disabled:opacity-50">
              <Wand2 size={13} /> Usar ejemplo (sin IA)
            </button>
            {onCancel && (
              <button onClick={onCancel} disabled={isLoading || saving} className="ml-auto flex items-center gap-1.5 px-3 py-2 bg-white/5 text-gray-400 rounded-xl text-xs hover:bg-white/10 disabled:opacity-50">
                <X size={13} /> Cancelar
              </button>
            )}
          </div>

          {/* Errores / avisos */}
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          {info && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">{info}</p>}

          {/* Bandeja de revisión */}
          {extraction && validation && (
            <div className="bg-[#0D0D12] border border-white/8 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Bandeja de revisión</p>
                <span className="text-[10px] text-gray-600">Fuente: voz · {userContext.primaryCurrency}</span>
              </div>

              {extraction.explanation && <p className="text-xs text-gray-400">{extraction.explanation}</p>}

              {/* Warnings (amarillo) */}
              {validation.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {validation.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w.message}
                    </p>
                  ))}
                </div>
              )}
              {/* Errors (rojo) */}
              {validation.errors.length > 0 && (
                <div className="space-y-1.5">
                  {validation.errors.map((e, i) => (
                    <p key={i} className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {e.message}
                    </p>
                  ))}
                </div>
              )}

              {/* Operaciones */}
              <div className="space-y-2">
                {extraction.operations.map((op: AIOperation, i: number) => {
                  const meta = typeMeta(op.type);
                  const currency = op.currency || userContext.primaryCurrency;
                  const desc = op.notes || op.merchant_or_contact || "Registro por voz";
                  return (
                    <div key={i} className="rounded-xl bg-[#16161F]/60 border border-white/5 p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${meta.cls}`}>{meta.label}</span>
                        <span className="text-base font-bold text-white">
                          {op.amount == null
                            ? <span className="text-red-400">Sin monto</span>
                            : <>{op.amount.toLocaleString("es-MX")} <span className="text-xs text-gray-500">{currency}</span></>}
                        </span>
                        <span className="text-xs text-gray-500 ml-auto">{op.date ?? userContext.today}{op.date == null ? " (hoy)" : ""}</span>
                      </div>
                      <p className={`text-[11px] font-medium ${aiOpCashEffect(op, userContext).cls}`}>{aiOpCashEffect(op, userContext).label}</p>
                      <p className="text-sm text-gray-200">{desc}</p>
                      {(op.category || op.merchant_or_contact) && (
                        <p className="text-[11px] text-gray-500">
                          {op.category && <span className="mr-2">Cat: <span className="text-gray-300">{op.category}</span></span>}
                          {op.merchant_or_contact && <span>Contacto/negocio: <span className="text-blue-300">{op.merchant_or_contact}</span></span>}
                        </p>
                      )}
                      {Array.isArray(op.ambiguities) && op.ambiguities.length > 0 && (
                        <p className="text-[10px] text-amber-400/80">⚠ {op.ambiguities.join(" · ")}</p>
                      )}
                      <p className="text-[10px] text-gray-600">Confianza: {Math.round((op.confidence ?? 0) * 100)}%</p>
                    </div>
                  );
                })}
              </div>

              {/* Botones de decisión */}
              <div className="flex gap-2 flex-wrap pt-1">
                <button
                  onClick={handleSave}
                  disabled={!validation.canProceed || saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-black rounded-xl text-sm font-bold hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : "💾"} Guardar
                </button>
                <button onClick={reset} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 bg-white/5 text-gray-300 rounded-xl text-sm hover:bg-white/10 disabled:opacity-50">
                  <RotateCcw size={14} /> Nuevo
                </button>
                {onCancel && (
                  <button onClick={onCancel} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 bg-white/5 text-gray-400 rounded-xl text-sm hover:bg-white/10 disabled:opacity-50">
                    <X size={14} /> Cancelar
                  </button>
                )}
              </div>
              {!validation.canProceed && <p className="text-[11px] text-red-400/80">Corrige los errores para poder guardar (usa "Nuevo" y graba de nuevo).</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
