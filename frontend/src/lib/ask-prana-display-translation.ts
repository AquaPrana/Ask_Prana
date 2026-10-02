import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { translateAskPranaHistory } from "../services/ask-prana";
import { type AskPranaSpeechLanguageCode } from "./ask-prana-language";

/**
 * Display-only translation store shared by the Ask Prana sidebar and chat.
 *
 * - Cached per (target language, source paragraph). Identical text in any
 *   message/session is translated once per language, and a Hindi result can
 *   never be read while Telugu is selected.
 * - Persisted per language on the device, so reopening Ask Prana or switching
 *   back to a language reuses earlier translations without new API calls.
 * - Requests made in the same tick are merged into batches; in-flight units are
 *   never requested twice. The open chat ("visible") is served before sidebar
 *   and older history ("background"), in small parallel batches so the first
 *   paragraphs land quickly instead of waiting for one long model response.
 * - The open chat is also pre-translated into the other languages at idle
 *   ("prefetch"), so switching language on it is served from cache.
 * - Until a translation arrives the original text is shown, so the chat never
 *   goes blank. Stored messages are never modified.
 */

type Language = AskPranaSpeechLanguageCode;

export type AskPranaTranslationStatus = "not_loaded" | "loading" | "ready" | "error";
export type AskPranaTranslationPriority = "visible" | "background" | "prefetch";

type Entry = {
  status: Exclude<AskPranaTranslationStatus, "not_loaded">;
  value?: string;
  failedAt?: number;
  attempts?: number;
};

type Job = { language: Language; priority: AskPranaTranslationPriority; texts: string[] };

// Model latency grows with output length, so the visible chat uses small
// batches that run in parallel; the sidebar/history uses larger ones.
const BATCH_LIMITS: Record<AskPranaTranslationPriority, { items: number; chars: number }> = {
  visible: { items: 3, chars: 320 },
  background: { items: 24, chars: 2400 },
  prefetch: { items: 8, chars: 1400 },
};
const MAX_CONCURRENT_REQUESTS = 6;
/** Caps per lower priority so the visible chat always has free request slots. */
const MAX_CONCURRENT_BY_PRIORITY: Record<AskPranaTranslationPriority, number> = {
  visible: MAX_CONCURRENT_REQUESTS,
  background: 2,
  prefetch: 4,
};
const RETRY_AFTER_MS = 5_000;
const MAX_ATTEMPTS = 2;
const STORAGE_PREFIX = "ask-prana:display-translations:v1:";
const MAX_PERSISTED_PER_LANGUAGE = 2_000;
const PERSIST_DEBOUNCE_MS = 800;
const LANGUAGES: Language[] = ["en", "hi", "te"];

const store: Record<Language, Map<string, Entry>> = {
  en: new Map(),
  hi: new Map(),
  te: new Map(),
};
const PRIORITY_ORDER: AskPranaTranslationPriority[] = ["visible", "background", "prefetch"];
const queues: Record<AskPranaTranslationPriority, Job[]> = { visible: [], background: [], prefetch: [] };
const inFlightByPriority: Record<AskPranaTranslationPriority, number> = {
  visible: 0,
  background: 0,
  prefetch: 0,
};
const listeners = new Set<() => void>();
let version = 0;
let activeLanguage: Language = "en";
/** Bumped on clear (sign-out) so late responses from the previous user are dropped. */
let generation = 0;

let notifyLanguageSwap: () => void = () => {};

function emit() {
  version += 1;
  for (const listener of listeners) listener();
  notifyLanguageSwap();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion() {
  return version;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const storageAvailable = !(Platform.OS === "web" && typeof window === "undefined");
let hydrated = !storageAvailable;
let hydration: Promise<void> | null = null;
const dirtyLanguages = new Set<Language>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function ensureHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydration) {
    const hydrationGeneration = generation;
    hydration = (async () => {
      try {
        const pairs = await AsyncStorage.multiGet(LANGUAGES.map((lang) => STORAGE_PREFIX + lang));
        if (hydrationGeneration !== generation) return;
        pairs.forEach(([, raw], index) => {
          if (!raw) return;
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") return;
          const cache = store[LANGUAGES[index]];
          for (const [source, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "string" && !cache.has(source)) {
              cache.set(source, { status: "ready", value });
            }
          }
        });
      } catch {
        // A corrupt/unavailable cache only means translating again.
      } finally {
        hydrated = true;
        emit();
      }
    })();
  }
  return hydration;
}

function schedulePersist(language: Language) {
  if (!storageAvailable) return;
  dirtyLanguages.add(language);
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const languages = [...dirtyLanguages];
    dirtyLanguages.clear();
    for (const lang of languages) {
      const ready: [string, string][] = [];
      for (const [source, entry] of store[lang]) {
        if (entry.status === "ready" && entry.value != null) ready.push([source, entry.value]);
      }
      // Map keeps insertion order, so this keeps the most recent translations.
      const kept = Object.fromEntries(ready.slice(-MAX_PERSISTED_PER_LANGUAGE));
      void AsyncStorage.setItem(STORAGE_PREFIX + lang, JSON.stringify(kept)).catch(() => undefined);
    }
  }, PERSIST_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

// Technical terms that may legitimately stay in Latin script in any language.
const TECHNICAL_TERMS =
  /\b(pH|DO|FCR|ABW|ADG|DOC|MQTT|RS485|RS-485|Modbus|IoT|TAN|ORP|TDS|NH3|NH4|NO2|NO3|PL|AquaPrana|Ask\s*Prana|Prana|PDF|DOCX|XLSX|CSV|HTTP|API|OTP|SMS|GPS|mg\/L|ppm|ppt|kg|gm|cm|mm|ml)\b/gi;
const URLS = /https?:\/\/\S+|\S+@\S+\.\S+/g;
const TELUGU = /[ఀ-౿]/g;
const DEVANAGARI = /[ऀ-ॿ]/g;
const LATIN_WORD = /[A-Za-z]{2,}/g;

const countMatches = (text: string, re: RegExp) => (text.match(re) || []).length;

function countScriptWords(line: string, re: RegExp) {
  return line.split(/\s+/).filter((word) => countMatches(word, re) > 0).length;
}

/** True when the text needs no translation to be shown in `language`. */
export function isTextInAskPranaLanguage(text: string, language: Language) {
  const cleaned = text.replace(URLS, " ").replace(TECHNICAL_TERMS, " ");
  const telugu = countMatches(cleaned, TELUGU);
  const devanagari = countMatches(cleaned, DEVANAGARI);

  if (language === "en") return telugu === 0 && devanagari === 0;

  const ownScript = language === "hi" ? DEVANAGARI : TELUGU;
  const otherIndic = language === "hi" ? telugu : devanagari;
  if (otherIndic > 0) return false;

  for (const line of cleaned.split(/\n+/)) {
    const latinWords = countMatches(line, LATIN_WORD);
    if (latinWords === 0) continue;
    const ownWords = countScriptWords(line, ownScript);
    // An English bullet/sentence, or a line that is mostly English words.
    if (ownWords === 0 || (latinWords >= 3 && latinWords > ownWords)) return false;
  }
  return true;
}

function isValidTranslation(source: string, translated: string, language: Language) {
  if (!translated.trim()) return false;
  if (language === "en") {
    return countMatches(translated, TELUGU) + countMatches(translated, DEVANAGARI) === 0;
  }
  const own = countMatches(translated, language === "hi" ? DEVANAGARI : TELUGU);
  const other = countMatches(translated, language === "hi" ? TELUGU : DEVANAGARI);
  if (other > 0) return false;
  // A source made only of technical terms/numbers may come back unchanged.
  const sourceHasWords =
    countMatches(source.replace(URLS, " ").replace(TECHNICAL_TERMS, " "), LATIN_WORD) > 0;
  return own > 0 || !sourceHasWords;
}

type Paragraph = { raw: string; key: string | null };

/** Lines longer than this are split at sentence ends. */
const MAX_UNIT_CHARS = 480;

function pushUnit(out: Paragraph[], raw: string, language: Language) {
  out.push(
    !raw.trim() || isTextInAskPranaLanguage(raw, language)
      ? { raw, key: null }
      : { raw, key: raw.trim() },
  );
}

/**
 * Splits text into translation units: one per line (list items, headings,
 * sentences), with very long lines split at sentence ends. Small units keep
 * each model response short — so requests run in parallel, finish quickly and
 * are never truncated. `key` is set only for natural-language units not
 * already in `language`; separators and fenced code blocks are kept as-is.
 */
function splitParagraphs(text: string, language: Language): Paragraph[] {
  const out: Paragraph[] = [];
  let inFence = false;
  text.split(/(\n+)/).forEach((raw, index) => {
    if (index % 2 === 1) {
      out.push({ raw, key: null });
      return;
    }
    if (raw.trimStart().startsWith("```")) {
      inFence = !inFence;
      out.push({ raw, key: null });
      return;
    }
    if (inFence) {
      out.push({ raw, key: null });
      return;
    }
    if (raw.length <= MAX_UNIT_CHARS) {
      pushUnit(out, raw, language);
      return;
    }
    raw.split(/([.!?]\s+)/).forEach((piece, pieceIndex) => {
      if (pieceIndex % 2 === 1) out.push({ raw: piece, key: null });
      else pushUnit(out, piece, language);
    });
  });
  return out;
}

type Resolved = { status: AskPranaTranslationStatus; text: string };

function isRetryable(entry: Entry | undefined, now = Date.now()) {
  return (
    entry?.status === "error" &&
    (entry.attempts ?? 1) < MAX_ATTEMPTS &&
    now - (entry.failedAt ?? 0) >= RETRY_AFTER_MS
  );
}

/** The whole string, or the original until every paragraph is translated. */
function resolveText(text: string, language: Language): Resolved {
  if (!text) return { status: "ready", text };
  const cache = store[language];
  const out: string[] = [];
  for (const paragraph of splitParagraphs(text, language)) {
    const entry = paragraph.key ? cache.get(paragraph.key) : undefined;
    if (!paragraph.key) {
      out.push(paragraph.raw);
      continue;
    }
    if (entry?.status === "ready" && entry.value != null) {
      const leading = paragraph.raw.match(/^\s*/)?.[0] ?? "";
      const trailing = paragraph.raw.match(/\s*$/)?.[0] ?? "";
      out.push(`${leading}${entry.value}${trailing}`);
      continue;
    }
    const status = entry?.status === "error" ? "error" : entry?.status === "loading" ? "loading" : "not_loaded";
    return { status, text };
  }
  return { status: "ready", text: out.join("") };
}

// ---------------------------------------------------------------------------
// Dev-only language-switch metrics
// ---------------------------------------------------------------------------

type SwitchMetrics = {
  from: Language;
  to: Language;
  startedAt: number;
  cached: number;
  needTranslation: number;
  batches: number;
  apiCalls: number;
  failed: number;
  visibleReadyMs?: number;
  logged: boolean;
};
let metrics: SwitchMetrics | null = null;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function startSwitchMetrics(from: Language, to: Language) {
  if (!__DEV__) return;
  metrics = {
    from,
    to,
    startedAt: now(),
    cached: 0,
    needTranslation: 0,
    batches: 0,
    apiCalls: 0,
    failed: 0,
    logged: false,
  };
}

function checkSwitchMetrics() {
  if (!__DEV__ || !metrics || metrics.logged || metrics.to !== activeLanguage) return;
  const hasWork = (priority: AskPranaTranslationPriority) =>
    inFlightByPriority[priority] > 0 ||
    queues[priority].some((job) => job.language === activeLanguage) ||
    pendingUnits.has(`${activeLanguage}|${priority}`);
  if (metrics.visibleReadyMs == null && !hasWork("visible")) {
    metrics.visibleReadyMs = Math.round(now() - metrics.startedAt);
  }
  if (!hasWork("visible") && !hasWork("background")) {
    metrics.logged = true;
    console.log("[AskPranaTranslation] language switch", {
      switch: `${metrics.from} → ${metrics.to}`,
      cached: metrics.cached,
      needTranslation: metrics.needTranslation,
      batches: metrics.batches,
      apiCalls: metrics.apiCalls,
      failed: metrics.failed,
      visibleReadyMs: metrics.visibleReadyMs,
      fullHistoryReadyMs: Math.round(now() - metrics.startedAt),
    });
  }
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/** Units requested in the current tick, merged into batches on flush. */
const pendingUnits = new Map<string, { language: Language; priority: AskPranaTranslationPriority; units: string[] }>();
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    for (const { language, priority, units } of pendingUnits.values()) {
      const limits = BATCH_LIMITS[priority];
      let batch: string[] = [];
      let batchChars = 0;
      const flush = () => {
        if (batch.length) queues[priority].push({ language, priority, texts: batch });
        batch = [];
        batchChars = 0;
      };
      for (const unit of units) {
        if (batch.length >= limits.items || (batch.length && batchChars + unit.length > limits.chars)) {
          flush();
        }
        batch.push(unit);
        batchChars += unit.length;
      }
      flush();
    }
    pendingUnits.clear();
    pump();
  }, 0);
}

function totalInFlight() {
  return inFlightByPriority.visible + inFlightByPriority.background + inFlightByPriority.prefetch;
}

function nextJob(): Job | undefined {
  for (const priority of PRIORITY_ORDER) {
    if (queues[priority].length && inFlightByPriority[priority] < MAX_CONCURRENT_BY_PRIORITY[priority]) {
      return queues[priority].shift();
    }
  }
  return undefined;
}

function pump() {
  while (totalInFlight() < MAX_CONCURRENT_REQUESTS) {
    const job = nextJob();
    if (!job) break;
    const cache = store[job.language];
    // Prefetch deliberately targets other languages; everything else is
    // dropped once the farmer has switched away from its language.
    if (job.priority !== "prefetch" && job.language !== activeLanguage) {
      // The farmer switched away; forget these so switching back re-requests them.
      for (const text of job.texts) {
        if (cache.get(text)?.status === "loading") cache.delete(text);
      }
      emit();
      continue;
    }
    const jobGeneration = generation;
    inFlightByPriority[job.priority] += 1;
    if (__DEV__ && job.priority !== "prefetch" && metrics?.to === job.language) {
      metrics.batches += 1;
      metrics.apiCalls += 1;
    }
    void translateAskPranaHistory(job.texts, job.language)
      .then((results) => {
        if (jobGeneration !== generation) return;
        job.texts.forEach((text, index) => {
          const value = results[index];
          if (typeof value === "string" && isValidTranslation(text, value, job.language)) {
            cache.set(text, { status: "ready", value: value.trim() });
          } else {
            const attempts = (cache.get(text)?.attempts ?? 0) + 1;
            cache.set(text, { status: "error", failedAt: Date.now(), attempts });
            if (__DEV__ && metrics?.to === job.language) metrics.failed += 1;
          }
        });
        schedulePersist(job.language);
      })
      .catch((error) => {
        if (jobGeneration !== generation) return;
        if (job.texts.length > 1) {
          // Retry items individually so one bad item cannot block the batch.
          for (const text of job.texts) {
            queues[job.priority].push({ language: job.language, priority: job.priority, texts: [text] });
          }
          return;
        }
        if (__DEV__) {
          console.log("[AskPranaTranslation] failed", {
            language: job.language,
            error: error instanceof Error ? error.message : String(error),
          });
          if (metrics?.to === job.language) metrics.failed += 1;
        }
        const attempts = (cache.get(job.texts[0])?.attempts ?? 0) + 1;
        cache.set(job.texts[0], { status: "error", failedAt: Date.now(), attempts });
      })
      .finally(() => {
        inFlightByPriority[job.priority] -= 1;
        emit();
        pump();
        checkSwitchMetrics();
      });
  }
}

/** Drops cached, persisted and queued translations, e.g. when the user signs out. */
export function clearAskPranaDisplayTranslations() {
  generation += 1;
  for (const priority of PRIORITY_ORDER) queues[priority].length = 0;
  pendingUnits.clear();
  dirtyLanguages.clear();
  for (const cache of Object.values(store)) cache.clear();
  if (storageAvailable) {
    void AsyncStorage.multiRemove(LANGUAGES.map((lang) => STORAGE_PREFIX + lang)).catch(() => undefined);
  }
  emit();
}

/**
 * Queue translations for every paragraph of `texts` not yet in `language`.
 * Cached, in-flight and permanently failed units are skipped, so repeated
 * calls (re-renders, sidebar reloads) never send duplicate requests.
 */
export function requestAskPranaDisplayTranslations(
  texts: readonly string[],
  language: Language,
  priority: AskPranaTranslationPriority = "background",
) {
  const isPrefetch = priority === "prefetch";
  if (!isPrefetch) {
    if (language !== activeLanguage) startSwitchMetrics(activeLanguage, language);
    activeLanguage = language;
  }
  if (!hydrated) {
    // Wait for the device cache first so cached text is never re-requested.
    void ensureHydrated().then(() => requestAskPranaDisplayTranslations(texts, language, priority));
    return;
  }

  const cache = store[language];
  const timestamp = Date.now();
  if (priority === "visible") {
    // Prefetch work already queued for this language is now needed on screen.
    const promoted = queues.prefetch.filter((job) => job.language === language);
    if (promoted.length) {
      queues.prefetch = queues.prefetch.filter((job) => job.language !== language);
      queues.visible.unshift(...promoted.map((job) => ({ ...job, priority: "visible" as const })));
      pump();
    }
  }
  const bucketKey = `${language}|${priority}`;
  const bucket = pendingUnits.get(bucketKey) ?? { language, priority, units: [] };
  const seen = new Set(bucket.units);
  let added = false;
  for (const text of texts) {
    if (!text) continue;
    for (const paragraph of splitParagraphs(text, language)) {
      const key = paragraph.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = cache.get(key);
      if (entry?.status === "ready") {
        if (__DEV__ && !isPrefetch && metrics?.to === language) metrics.cached += 1;
        continue;
      }
      if (entry?.status === "loading") continue;
      if (entry?.status === "error" && !isRetryable(entry, timestamp)) continue;
      cache.set(key, { status: "loading", attempts: entry?.attempts });
      bucket.units.push(key);
      if (__DEV__ && !isPrefetch && metrics?.to === language) metrics.needTranslation += 1;
      added = true;
    }
  }
  if (added) {
    pendingUnits.set(bucketKey, bucket);
    emit();
    scheduleFlush();
  } else {
    checkSwitchMetrics();
  }
}

/**
 * Selects the language used to render the cache without scheduling work.
 * This is intentionally separate from requestAskPranaDisplayTranslations so
 * changing the picker can never be the cause of a translate-history call.
 */
export function getAskPranaDisplayLanguage(): Language {
  return activeLanguage;
}

export function setAskPranaDisplayLanguage(language: Language) {
  if (language === activeLanguage) return;
  startSwitchMetrics(activeLanguage, language);
  activeLanguage = language;
  version += 1;
  for (const listener of listeners) listener();
  checkSwitchMetrics();
}

const visibleTextSets = new Map<string, readonly string[]>();
type PendingLanguageSwap = {
  language: Language;
  apply: (language: Language) => void;
};
let pendingLanguageSwap: PendingLanguageSwap | null = null;

export function registerVisibleAskPranaTexts(id: string, texts: readonly string[]) {
  visibleTextSets.set(id, texts);
  flushPendingLanguageSwap();
}

export function unregisterVisibleAskPranaTexts(id: string) {
  visibleTextSets.delete(id);
}

function visibleAskPranaTexts() {
  return [...visibleTextSets.values()].flat();
}

/** True when every visible string can render in `language` without another request. */
export function isAskPranaDisplayLanguageReady(language: Language, texts: readonly string[] = visibleAskPranaTexts()) {
  // Nothing has registered yet, so a click must not switch the menus early.
  if (visibleTextSets.size === 0) return false;
  return texts.every((text) => !text?.trim() || resolveText(text, language).status === "ready");
}

function flushPendingLanguageSwap() {
  const pending = pendingLanguageSwap;
  if (!pending || !hydrated) return;
  if (!isAskPranaDisplayLanguageReady(pending.language)) return;
  pendingLanguageSwap = null;
  setAskPranaDisplayLanguage(pending.language);
  pending.apply(pending.language);
}

notifyLanguageSwap = flushPendingLanguageSwap;

/**
 * Applies `language` only when the whole visible set is already cached.
 * The picker must not queue a translation. Prefetch started when the
 * messages arrived; this waits for that cache and then swaps once.
 */
export function selectAskPranaLanguageWhenReady(
  language: Language,
  apply: (language: Language) => void,
) {
  const commit = () => {
    if (isAskPranaDisplayLanguageReady(language)) {
      pendingLanguageSwap = null;
      setAskPranaDisplayLanguage(language);
      apply(language);
      return;
    }
    pendingLanguageSwap = { language, apply };
  };
  if (hydrated) commit();
  else void ensureHydrated().then(commit);
}

/**
 * Selected-language display for Ask Prana content. The language comes from
 * i18next — the same source as every static Ask Prana label.
 */
export function useAskPranaDisplayTranslation(
  texts: readonly string[],
  priority: Exclude<AskPranaTranslationPriority, "prefetch"> = "background",
  options?: {
    prefetchOtherLanguages?: boolean;
    /** Only the first N texts use `priority`; the rest translate in the background. */
    priorityCount?: number;
  },
) {
  void priority;
  void options;
  const sourceId = useId();
  const storeVersion = useSyncExternalStore(subscribe, getVersion, getVersion);
  const signature = texts.join("␞");
  // The committed display language, not i18next. i18next changes in the same
  // update that selects this cache, so menus and chat cannot move apart.
  const language = storeVersion >= 0 ? activeLanguage : activeLanguage;

  const preparedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    registerVisibleAskPranaTexts(sourceId, signature ? signature.split("␞") : []);
    return () => unregisterVisibleAskPranaTexts(sourceId);
  }, [signature, sourceId]);

  useEffect(() => {
    if (!signature || preparedSignatureRef.current === signature) return;
    preparedSignatureRef.current = signature;
    const sources = signature.split("␞");
    // Store English, Hindi, and Telugu when the text arrives. A later picker
    // click only reads this cache and must not start another request.
    for (const target of LANGUAGES) {
      requestAskPranaDisplayTranslations(sources, target, "prefetch");
    }
  }, [signature]);

  const retryDue = useMemo(() => {
    if (storeVersion < 0 || !signature) return false;
    const sources = signature.split("␞");
    return LANGUAGES.some((target) => {
      const cache = store[target];
      return sources.some((text) =>
        splitParagraphs(text, target).some((paragraph) => {
          const entry = paragraph.key ? cache.get(paragraph.key) : undefined;
          return entry?.status === "error" && (entry.attempts ?? 1) < MAX_ATTEMPTS;
        }),
      );
    });
  }, [signature, storeVersion]);

  useEffect(() => {
    if (!retryDue) return;
    const timer = setTimeout(() => {
      const sources = signature.split("␞");
      for (const target of LANGUAGES) {
        requestAskPranaDisplayTranslations(sources, target, "prefetch");
      }
    }, RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [retryDue, signature]);

  const getStatus = useCallback(
    (text: string) => (storeVersion >= 0 ? resolveText(text, activeLanguage).status : "not_loaded"),
    [storeVersion],
  );

  const displayText = useCallback(
    (text: string) => (storeVersion >= 0 ? resolveText(text, activeLanguage).text : text),
    [storeVersion],
  );

  return { language, displayText, getStatus };
}
