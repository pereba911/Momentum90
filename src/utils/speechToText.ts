// Wrapper de la Web Speech API (webkitSpeechRecognition) para dictado por voz.
// Primera opción: gratis y nativa en Chrome/Edge. Requiere permiso de micrófono.
// En navegadores sin soporte devuelve un error claro (no rompe la app).

export interface SpeechHandlers {
  onResult: (interim: string, final: string) => void;
  onError: (code: string, message: string) => void;
  onEnd: () => void;
}

type SpeechRecognitionCtor = new () => any;

// Devuelve la clase de reconocimiento disponible o null si no hay soporte.
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  if (typeof w.SpeechRecognition !== "undefined") return w.SpeechRecognition as SpeechRecognitionCtor;
  if (typeof w.webkitSpeechRecognition !== "undefined") return w.webkitSpeechRecognition as SpeechRecognitionCtor;
  return null;
}

export function isSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

const DEFAULT_ERRORS: Record<string, string> = {
  "no-speech": "No se detectó voz. Inténtalo de nuevo.",
  "audio-capture": "No se encontró micrófono.",
  "not-allowed": "Permiso de micrófono denegado. Habilítalo en tu navegador.",
  "service-not-allowed": "El servicio de voz no está disponible en este navegador.",
  network: "Error de red del servicio de voz.",
  aborted: "Grabación cancelada.",
};

export interface ActiveRecognition {
  recognition: any;
  stop: () => void;
}

// Inicia el reconocimiento en es-MX con resultados intermedios.
// maxSeconds: tope de grabación (default 10 s); al llegar, detiene solo.
export function startSpeechRecognition(handlers: SpeechHandlers, maxSeconds = 10): ActiveRecognition {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    handlers.onError("not-supported", "Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.");
    return { recognition: null, stop: () => {} };
  }

  const rec = new Ctor();
  rec.lang = "es-MX";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimer();
    try { rec.stop(); } catch { /* ya detenido */ }
  };

  rec.onresult = (event: any) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const transcript = res?.[0]?.transcript ?? "";
      if (res.isFinal) finalText += transcript;
      else interim += transcript;
    }
    handlers.onResult(interim, finalText);
  };

  rec.onerror = (event: any) => {
    const code = event?.error || "unknown";
    handlers.onError(code, DEFAULT_ERRORS[code] || `Error de reconocimiento: ${code}`);
  };

  rec.onend = () => {
    clearTimer();
    handlers.onEnd();
  };

  try {
    rec.start();
  } catch {
    handlers.onError("start-failed", "No se pudo iniciar el micrófono. Verifica el permiso.");
    return { recognition: rec, stop: () => {} };
  }

  timer = setTimeout(() => finish(), maxSeconds * 1000);

  return { recognition: rec, stop: () => finish() };
}

// Detiene el reconocimiento activo (si existe).
export function stopSpeechRecognition(recognition: any): void {
  if (!recognition) return;
  try { recognition.stop(); } catch { /* ya detenido */ }
}
