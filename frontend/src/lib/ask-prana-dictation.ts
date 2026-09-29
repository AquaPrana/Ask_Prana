import { Platform } from "react-native";
import {
  getAskPranaLanguageOption,
  type AskPranaSpeechLanguageCode,
} from "./ask-prana-language";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type WebDictationHandlers = {
  onPartial: (text: string) => void;
  onError: (message: string) => void;
};

export type WebDictationSession = {
  stop: () => Promise<string>;
  cancel: () => void;
};

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebDictationAvailable(): boolean {
  return getSpeechRecognitionCtor() != null;
}

/**
 * Browser-native speech-to-text (no OpenAI). Used for Ask Prana composer
 * dictation on web when cloud transcription is unavailable or preferred.
 */
export function startWebDictation(
  language: AskPranaSpeechLanguageCode,
  handlers: WebDictationHandlers,
): WebDictationSession {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    throw new Error("WEB_DICTATION_UNAVAILABLE");
  }

  const recognition = new Ctor();
  const option = getAskPranaLanguageOption(language);
  recognition.lang = option.bcp47 || "en-IN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let interimText = "";
  let settled = false;
  let stopRequested = false;
  let resolveStop: ((value: string) => void) | null = null;

  const emitPartial = () => {
    const combined = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
    handlers.onPartial(combined);
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const piece = result?.[0]?.transcript?.trim() ?? "";
      if (!piece) continue;
      if (result.isFinal) {
        finalText = `${finalText} ${piece}`.replace(/\s+/g, " ").trim();
      } else {
        interim = `${interim} ${piece}`.trim();
      }
    }
    interimText = interim;
    emitPartial();
  };

  recognition.onerror = (event) => {
    const code = String(event?.error ?? "unknown");
    // "aborted" / "no-speech" are normal stop/cancel paths.
    if (code === "aborted" || code === "no-speech") {
      return;
    }
    console.log("[AskPranaDictation] web speech error:", code);
    if (code === "not-allowed" || code === "service-not-allowed") {
      handlers.onError(
        "Microphone or speech permission was blocked. Allow mic access in the browser and try again.",
      );
    } else {
      handlers.onError("Could not hear that clearly. Please try speaking again.");
    }
  };

  recognition.onend = () => {
    if (settled) return;
    if (!stopRequested) {
      // Browser sometimes ends mid-session — restart while still recording.
      try {
        recognition.start();
        return;
      } catch {
        // fall through and settle
      }
    }
    settled = true;
    const text = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
    resolveStop?.(text);
    resolveStop = null;
  };

  try {
    recognition.start();
  } catch (error) {
    console.log("[AskPranaDictation] failed to start:", error);
    throw new Error("WEB_DICTATION_START_FAILED");
  }

  return {
    stop: () =>
      new Promise<string>((resolve) => {
        if (settled) {
          resolve(`${finalText} ${interimText}`.replace(/\s+/g, " ").trim());
          return;
        }
        stopRequested = true;
        resolveStop = resolve;
        try {
          recognition.stop();
        } catch {
          settled = true;
          resolve(`${finalText} ${interimText}`.replace(/\s+/g, " ").trim());
        }
        // Safety: if onend never fires
        setTimeout(() => {
          if (!settled) {
            settled = true;
            try {
              recognition.abort();
            } catch {
              // ignore
            }
            resolve(`${finalText} ${interimText}`.replace(/\s+/g, " ").trim());
          }
        }, 2500);
      }),
    cancel: () => {
      stopRequested = true;
      settled = true;
      resolveStop?.("");
      resolveStop = null;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    },
  };
}
