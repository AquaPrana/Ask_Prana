import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ASK_PRANA_FONT_FAMILY } from "../constants/ask-prana-typography";
import { AskPranaLogo } from "./ask-prana-logo";
import type { AskPranaRequestContext } from "../services/ask-prana";
import {
  ASK_PRANA_LANGUAGE_OPTIONS,
  getAskPranaLanguageOption,
  type AskPranaSpeechLanguageCode,
} from "../lib/ask-prana-language";
import {
  speakAskPranaText,
  stopAskPranaSpeech,
} from "../lib/ask-prana-speech";

const colors = {
  primary: "#0F766E",
  primaryDark: "#0B5F59",
  background: "#0B1F24",
  card: "#123038",
  white: "#FFFFFF",
  muted: "#9DB4B8",
  text: "#E8F4F2",
  danger: "#F87171",
  orb: "#14B8A6",
  orbSoft: "rgba(45, 212, 191, 0.35)",
};

export type VoiceModeState =
  | "listening"
  | "processing"
  | "speaking"
  | "muted"
  | "reconnecting"
  | "error"
  | "idle";

type TranscriptLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type Props = {
  visible: boolean;
  language: AskPranaSpeechLanguageCode;
  requestContext: AskPranaRequestContext;
  isRecording: boolean;
  isTranscribing: boolean;
  isSending: boolean;
  draft: string;
  onChangeDraft: (value: string) => void;
  onClose: () => void;
  onStartListening: () => Promise<void>;
  onStopListeningToTranscript: () => Promise<string | null>;
  onAsk: (
    question: string,
    context: AskPranaRequestContext,
  ) => Promise<{ answer: string; language: AskPranaSpeechLanguageCode } | null>;
  onLanguageChange: (code: AskPranaSpeechLanguageCode) => Promise<void>;
};

function voiceTurnErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Could not process that voice turn. Check your connection and try again.";
}

export function AskPranaVoiceModeModal({
  visible,
  language,
  requestContext,
  isRecording,
  isTranscribing,
  isSending,
  draft,
  onChangeDraft,
  onClose,
  onStartListening,
  onStopListeningToTranscript,
  onAsk,
  onLanguageChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<VoiceModeState>("idle");
  const [muted, setMuted] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [pulse, setPulse] = useState(0);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [activeLanguage, setActiveLanguage] =
    useState<AskPranaSpeechLanguageCode>(language);
  const loopArmedRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const stateRef = useRef<VoiceModeState>("idle");
  const isRecordingRef = useRef(false);
  const orbPressLockRef = useRef(false);
  const languageLabel = getAskPranaLanguageOption(activeLanguage).nativeLabel;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (visible) {
      setActiveLanguage(language);
    }
  }, [visible, language]);

  const appendLine = useCallback((role: "user" | "assistant", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLines((current) => [
      ...current,
      { id: `${Date.now()}-${role}-${current.length}`, role, text: trimmed },
    ]);
  }, []);

  const cleanupSession = useCallback(async () => {
    sessionActiveRef.current = false;
    loopArmedRef.current = false;
    await stopAskPranaSpeech();
    setState("idle");
  }, []);

  useEffect(() => {
    if (!visible) {
      void cleanupSession();
      setLines([]);
      setErrorText(null);
      setMuted(false);
      return;
    }

    sessionActiveRef.current = true;
    loopArmedRef.current = true;
    setState(muted ? "muted" : "listening");
    if (!muted) {
      void onStartListening().catch(() => {
        setState("error");
        setErrorText("Could not start the microphone.");
      });
    }

    return () => {
      sessionActiveRef.current = false;
      void stopAskPranaSpeech();
    };
    // Intentionally run on visible/muted open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || (state !== "listening" && state !== "speaking")) return;
    const timer = setInterval(() => {
      setPulse((current) => (current + 1) % 3);
    }, 420);
    return () => clearInterval(timer);
  }, [visible, state]);

  const runTurnFromTranscript = useCallback(
    async (transcript: string) => {
      if (!sessionActiveRef.current) return;
      const cleaned = transcript.trim();
      console.log("[AskPranaVoice] transcript received", {
        length: cleaned.length,
        preview: cleaned.slice(0, 120),
      });
      appendLine("user", cleaned);
      setState("processing");
      setErrorText(null);
      try {
        console.log("[AskPranaVoice] ask started");
        const result = await onAsk(cleaned, {
          ...requestContext,
          // Voice header language (e.g. తెలుగు) must drive replies even if STT is messy.
          sessionLanguageCode: activeLanguage,
          language: getAskPranaLanguageOption(activeLanguage).llmLabel,
        });
        if (!sessionActiveRef.current) return;
        if (!result?.answer?.trim()) {
          console.log("[AskPranaVoice] ask returned empty answer");
          setState("error");
          setErrorText(
            "Ask Prana could not answer that turn. Tap the orb to try again, or use text chat.",
          );
          return;
        }
        const cleanedAnswer = result.answer.trim();
        if (/^no response received\.?$/i.test(cleanedAnswer)) {
          setState("error");
          setErrorText(
            "Ask Prana could not finish that answer. Tap the orb to try again.",
          );
          appendLine(
            "assistant",
            "Sorry — I could not finish that answer just now. Please ask again.",
          );
          return;
        }
        // The Voice Mode header is an explicit user selection. A reply's text
        // must never change it (for example, Telugu → Tamil/English).
        const replyLanguage = activeLanguage;
        console.log("[AskPranaVoice] ask ok", {
          answerLength: cleanedAnswer.length,
          replyLanguage,
        });
        appendLine("assistant", cleanedAnswer);
        if (muted) {
          setState("muted");
          return;
        }
        setState("speaking");
        console.log("[AskPranaVoice] speak started", { replyLanguage });
        const spoken = await speakAskPranaText(cleanedAnswer, replyLanguage);
        if (!sessionActiveRef.current) return;
        if (!spoken.spoke) {
          console.log("[AskPranaVoice] speak failed", spoken.reason);
          setErrorText(
            spoken.reason ||
              "Could not play speech. The reply is shown above — listening continues.",
          );
        } else {
          console.log("[AskPranaVoice] speak finished", { provider: spoken.provider });
          setErrorText(null);
        }
        if (muted || !sessionActiveRef.current) {
          setState(muted ? "muted" : "idle");
          return;
        }
        setState("listening");
        console.log("[AskPranaVoice] resuming listen");
        await onStartListening();
      } catch (error) {
        console.log("[AskPranaVoice] turn failed:", error);
        if (!sessionActiveRef.current) return;
        setState("error");
        setErrorText(
          error instanceof Error
            ? error.message
            : "Voice turn failed. You can keep using text chat.",
        );
      }
    },
    [
      activeLanguage,
      appendLine,
      muted,
      onAsk,
      onStartListening,
      requestContext,
    ],
  );

  const finishListeningTurn = useCallback(async () => {
    if (!sessionActiveRef.current || muted) return;
    // Immediate UI feedback — do not wait on React isRecording (can be stale).
    setState("processing");
    stateRef.current = "processing";
    setErrorText(null);
    try {
      // Always attempt stop; capture path no-ops if mic is not live.
      const transcript = await onStopListeningToTranscript();
      if (!sessionActiveRef.current) return;
      if (!transcript?.trim()) {
        console.log("[AskPranaVoice] empty transcript after stop — idle");
        setState("idle");
        stateRef.current = "idle";
        setErrorText("No speech captured. Tap the orb to speak again.");
        return;
      }
      await runTurnFromTranscript(transcript.trim());
    } catch (error) {
      console.log("[AskPranaVoice] finish listen failed:", error);
      setState("error");
      stateRef.current = "error";
      // Keep the actionable server/recording error. The previous generic copy
      // concealed whether the microphone, transcription service, or Ask Prana
      // reply had failed, making both mic entry points look broken.
      setErrorText(voiceTurnErrorMessage(error));
    }
  }, [muted, onStopListeningToTranscript, runTurnFromTranscript]);

  const handleOrbPress = useCallback(async () => {
    if (!sessionActiveRef.current || orbPressLockRef.current) return;
    if (muted) {
      Alert.alert("Muted", "Unmute to continue the spoken conversation.");
      return;
    }

    const current = stateRef.current;
    if (current === "processing") return;

    orbPressLockRef.current = true;
    try {
      if (current === "speaking") {
        await stopAskPranaSpeech();
        setState("listening");
        stateRef.current = "listening";
        await onStartListening();
        return;
      }

      // Stop: UI listening or mic actually live (refs avoid stale React state).
      if (current === "listening" || isRecordingRef.current) {
        // Release lock before the long ask/speak path so user can interrupt later.
        orbPressLockRef.current = false;
        await finishListeningTurn();
        return;
      }

      // Start: idle / error / muted-unmute path
      if (
        current === "error" ||
        current === "idle" ||
        current === "muted" ||
        current === "reconnecting"
      ) {
        setErrorText(null);
        setState("listening");
        stateRef.current = "listening";
        await onStartListening();
      }
    } finally {
      orbPressLockRef.current = false;
    }
  }, [finishListeningTurn, muted, onStartListening]);

  const handleMuteToggle = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    if (next) {
      await stopAskPranaSpeech();
      setState("muted");
      return;
    }
    setState("listening");
    await onStartListening();
  }, [muted, onStartListening]);

  const handleEnd = useCallback(async () => {
    await cleanupSession();
    onClose();
  }, [cleanupSession, onClose]);

  const handleLanguageChange = useCallback(
    async (code: AskPranaSpeechLanguageCode) => {
      if (code === activeLanguage) {
        setLanguageMenuOpen(false);
        return;
      }

      setLanguageMenuOpen(false);
      setErrorText(null);
      await stopAskPranaSpeech();
      await onLanguageChange(code);
      if (!sessionActiveRef.current) return;
      setActiveLanguage(code);
      setState("listening");
      stateRef.current = "listening";
      await onStartListening();
    },
    [activeLanguage, onLanguageChange, onStartListening],
  );

  const handleSendTyped = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending || isTranscribing) return;
    onChangeDraft("");
    await stopAskPranaSpeech();
    await runTurnFromTranscript(text);
  }, [
    draft,
    isSending,
    isTranscribing,
    onChangeDraft,
    runTurnFromTranscript,
  ]);

  const statusLabel = (() => {
    if (state === "listening") return "Listening… tap orb to stop";
    if (state === "processing" || isTranscribing || isSending)
      return "Processing…";
    if (state === "speaking") return "Speaking… tap orb to interrupt";
    if (state === "muted") return "Muted";
    if (state === "reconnecting") return "Reconnecting…";
    if (state === "error") return errorText || "Something went wrong";
    if (state === "idle") return "Tap orb to start listening";
    return "Tap orb to start listening";
  })();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        void handleEnd();
      }}
    >
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <AskPranaLogo size={36} decorative />
            <View>
            <Text style={styles.title}>Ask Prana Voice</Text>
            <Pressable
              onPress={() => setLanguageMenuOpen((open) => !open)}
              style={styles.languagePicker}
              accessibilityRole="button"
              accessibilityLabel="Change voice language"
            >
              <Text style={styles.subtitle}>{languageLabel}</Text>
              <Feather name="chevron-down" size={14} color={colors.muted} />
            </Pressable>
            </View>
          </View>
          <Pressable onPress={() => void handleEnd()} style={styles.iconBtn} accessibilityLabel="End voice">
            <Feather name="x" size={20} color={colors.white} />
          </Pressable>
        </View>

        {languageMenuOpen ? (
          <View style={styles.languageMenu}>
            {ASK_PRANA_LANGUAGE_OPTIONS.map((option) => (
              <Pressable
                key={option.code}
                onPress={() => void handleLanguageChange(option.code)}
                style={[
                  styles.languageOption,
                  option.code === activeLanguage && styles.languageOptionActive,
                ]}
              >
                <Text style={styles.languageOptionText}>{option.nativeLabel}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
          {lines.length === 0 ? (
            <Text style={styles.empty}>
              Speak naturally. Transcripts appear here. You can also type below.
            </Text>
          ) : (
            lines.map((line) => (
              <View
                key={line.id}
                style={[
                  styles.line,
                  line.role === "user" ? styles.lineUser : styles.lineAssistant,
                ]}
              >
                <Text style={styles.lineText}>{line.text}</Text>
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.orbWrap}>
          <Pressable
            onPress={() => {
              void handleOrbPress();
            }}
            style={[
              styles.orbOuter,
              (state === "listening" || state === "speaking") && {
                transform: [{ scale: 1 + pulse * 0.04 }],
                shadowOpacity: 0.35 + pulse * 0.1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Voice orb"
          >
            <View style={styles.orbInner}>
              {state === "processing" || isTranscribing || isSending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Feather
                  name={state === "muted" ? "mic-off" : state === "speaking" ? "volume-2" : "mic"}
                  size={36}
                  color={colors.white}
                />
              )}
            </View>
          </Pressable>
          <Text style={styles.status}>{statusLabel}</Text>
          {errorText && state !== "error" ? (
            <Text style={styles.errorHint}>{errorText}</Text>
          ) : null}
        </View>

        <View style={styles.composerRow}>
          <TextInput
            value={draft}
            onChangeText={onChangeDraft}
            placeholder="Type while in voice mode"
            placeholderTextColor={colors.muted}
            style={styles.input}
            editable={!isSending && !isTranscribing}
          />
          <Pressable
            onPress={() => {
              void handleSendTyped();
            }}
            style={styles.sendBtn}
            disabled={!draft.trim() || isSending}
          >
            <Feather name="send" size={16} color={colors.white} />
          </Pressable>
        </View>

        <View style={styles.controls}>
          <Pressable onPress={() => void handleMuteToggle()} style={styles.controlBtn}>
            <Feather
              name={muted ? "mic-off" : "mic"}
              size={18}
              color={colors.white}
            />
            <Text style={styles.controlText}>{muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
          <Pressable onPress={() => void handleEnd()} style={[styles.controlBtn, styles.endBtn]}>
            <Feather name="x-circle" size={18} color={colors.white} />
            <Text style={styles.controlText}>End</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: colors.white, fontFamily: ASK_PRANA_FONT_FAMILY, fontSize: 18, lineHeight: 23, fontWeight: "600" },
  subtitle: { color: colors.muted, fontFamily: ASK_PRANA_FONT_FAMILY, fontSize: 13, lineHeight: 18, marginTop: 2, fontWeight: "500" },
  languagePicker: { flexDirection: "row", alignItems: "center", gap: 2 },
  languageMenu: { flexDirection: "row", gap: 8 },
  languageOption: {
    borderColor: colors.muted,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  languageOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  languageOptionText: { color: colors.text, fontFamily: ASK_PRANA_FONT_FAMILY, fontSize: 12, lineHeight: 16, fontWeight: "500" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  transcript: { flex: 1 },
  transcriptContent: { gap: 10, paddingVertical: 8 },
  empty: { color: colors.muted, fontFamily: ASK_PRANA_FONT_FAMILY, fontSize: 14, lineHeight: 21, fontWeight: "400" },
  line: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: "92%",
  },
  lineUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.primaryDark,
  },
  lineAssistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
  },
  lineText: { color: colors.text, fontFamily: ASK_PRANA_FONT_FAMILY, fontSize: 14, lineHeight: 21, fontWeight: "400" },
  orbWrap: { alignItems: "center", gap: 10, paddingVertical: 8 },
  orbOuter: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.orbSoft,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.orb,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 24,
    elevation: 8,
  },
  orbInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.orb,
    alignItems: "center",
    justifyContent: "center",
  },
  status: {
    color: colors.text,
    fontFamily: ASK_PRANA_FONT_FAMILY,
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 12,
  },
  errorHint: {
    color: colors.danger,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    color: colors.white,
    paddingHorizontal: 16,
    fontFamily: ASK_PRANA_FONT_FAMILY,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "400",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  controlBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  endBtn: { backgroundColor: "#7F1D1D" },
  controlText: { color: colors.white, fontFamily: ASK_PRANA_FONT_FAMILY, fontWeight: "600", fontSize: 13, lineHeight: 18 },
});
