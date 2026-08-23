// Wrapper ROBUSTO de la Web Speech API (webkitSpeechRecognition) para dictado por voz.
// Máquina de estados: idle → requesting_permission → listening → processing → idle/error.
// NUNCA llama start() dos veces en la misma sesión y SIEMPRE vuelve a idle en onend.
// El límite de tiempo es SOLO de seguridad: detiene pero conserva la transcripción.

export type SpeechStatus = "idle" | "requesting_permission" | "listening" | "processing" | "error";

export interface SpeechHandlers {
  onStatusChange?: (status: SpeechStatus) => void;
  onResult: (interim: string, final: string) => void;
  onError: (code: string, message: string) => void;
  onEnd: () => void;
}

export interface SpeechOptions {
  lang?: string;         // default "es-MX"
  maxSeconds?: number;   // límite de SEGURIDAD (default 10); no descarta transcripción
  continuous?: boolean;  // default true
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

export const SPEECH_ERROR_MESSAGES: Record<string, string> = {
  "no-speech": "No se detectó voz. Inténtalo de nuevo.",
  "audio-capture": "No se encontró micrófono.",
  "not-allowed": "Permiso de micrófono denegado. Habilítalo en tu navegador y vuelve a intentar.",
  "service-not-allowed": "El servicio de voz no está disponible en este navegador.",
  network: "Error de red del servicio de voz. Revisa tu conexión.",
  aborted: "Grabación cancelada.",
  "not-supported": "Tu navegador no soporta reconocimiento de voz. Escribe el texto manualmente.",
  "start-failed": "No se pudo iniciar el micrófono. Verifica el permiso.",
};

export interface ActiveRecognition {
  recognition: any;
  stop: () => void;    // detención suave: conserva la transcripción ya capturada
  abort: () => void;   // detención inmediata: para desmontaje/cierre
}

// Inicia el reconocimiento en es-MX. Garantiza un único start por sesión y que
// onend siempre regrese el estado a "idle" (nunca deja la UI congelada).
export function startSpeechRecognition(handlers: SpeechHandlers, opts: SpeechOptions = {}): ActiveRecognition {
  const { lang = "es-MX", maxSeconds = 10, continuous = true } = opts;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    handlers.onStatusChange?.("error");
    handlers.onError("not-supported", SPEECH_ERROR_MESSAGES["not-supported"]);
    return { recognition: null, stop: () => {}, abort: () => {} };
  }

  let started = false;
  let ended = false;
  let finalText = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const rec = new Ctor();

  const setStatus = (s: SpeechStatus) => handlers.onStatusChange?.(s);
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const safeStop = () => { try { rec.stop(); } catch { /* ya detenido */ } };
  const safeAbort = () => { try { rec.abort(); } catch { /* ya detenido */ } };

  // Detención suave: dispara onend → idle, sin descartar la transcripción.
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimer();
    safeStop();
  };

  rec.lang = lang;
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => { started = true; setStatus("listening"); };

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
    if (code !== "aborted") setStatus("error"); // aborted → onend lo lleva a idle
    handlers.onError(code, SPEECH_ERROR_MESSAGES[code] || `Error de reconocimiento: ${code}`);
  };

  rec.onend = () => {
    clearTimer();
    ended = true;
    setStatus("idle"); // SIEMPRE volver a idle
    handlers.onEnd();
  };

  try {
    setStatus("requesting_permission");
    rec.start();
  } catch {
    setStatus("error");
    handlers.onError("start-failed", SPEECH_ERROR_MESSAGES["start-failed"]);
    return { recognition: rec, stop: () => {}, abort: () => safeAbort() };
  }

  // Límite de SEGURIDAD: solo detiene; la transcripción ya capturada se conserva.
  if (maxSeconds > 0) {
    timer = setTimeout(() => { if (!ended) safeStop(); }, maxSeconds * 1000);
  }

  return {
    recognition: rec,
    stop: () => finish(),
    abort: () => { clearTimer(); ended = true; safeAbort(); },
  };
}

// Detiene el reconocimiento activo de forma segura (no lanza).
export function stopSpeechRecognition(recognition: any): void {
  if (!recognition) return;
  try { recognition.stop(); } catch { /* ya detenido */ }
}
