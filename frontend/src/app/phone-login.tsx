import { useRef, useState } from "react";
import {
  Geist_500Medium,
  Geist_700Bold,
  Geist_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/geist";
import { classifyOtpSendError, sendOTP } from "../services/auth";
import { isValidEmail, normalizeEmail, sendEmailLoginCode } from "../services/profile";
import {
  AUTH_DARK_BACKGROUND,
  PhoneLoginBackground,
} from "../components/phone-login-background";
import { AskPranaLogo } from "../components/ask-prana-logo";
import { PrimaryCtaGradientFill } from "../components/primary-cta-gradient";
import { PRIMARY_CTA_START } from "../constants/primary-cta";

import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

// Dark Ask Prana theme with teal accents taken from the logo.
const colors = {
  primary: "#2DD4BF",
  primaryDark: "#0B5F59",
  primaryBright: "#5EEAD4",
  background: AUTH_DARK_BACKGROUND,
  white: "#FFFFFF",
  text: "#F5F5F5",
  textSoft: "#C9D1D0",
  muted: "#A0A0A0",
  border: "#363636",
  inputBg: "#212121",
  placeholder: "#6F7777",
  error: "#F87171",
  ctaDisabled: "#26302F",
  ctaDisabledText: "#7C8886",
  ctaGradientStart: PRIMARY_CTA_START,
  shadow: "#000000",
};

const fonts = {
  medium: "Geist_500Medium",
  bold: "Geist_700Bold",
  extraBold: "Geist_800ExtraBold",
} as const;

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const MESSAGES = {
  empty: "Please enter your email or mobile number.",
  invalid_email: "Please enter a valid email address.",
  invalid_phone: "Please enter a valid 10-digit mobile number.",
  failed: "Unable to send OTP. Please try again.",
  rate_limited: "Too many OTP requests. Please wait a moment and try again.",
  network: "Network error. Please check your connection and try again.",
} as const;

type LoginIdentifier =
  | { authMethod: "email"; identifier: string }
  | { authMethod: "phone"; identifier: string };

/**
 * Works out whether the single login field holds an email or an Indian mobile
 * number. Emails are normalized for Supabase; mobiles become +91XXXXXXXXXX and
 * an existing +91 / 91 / leading 0 is never duplicated.
 */
function parseLoginIdentifier(
  raw: string,
): LoginIdentifier | { error: "empty" | "invalid_email" | "invalid_phone" } {
  const value = raw.trim();
  if (!value) return { error: "empty" };

  // "@" or any letter means the user is typing an email, not a number.
  if (value.includes("@") || /[a-z]/i.test(value)) {
    return isValidEmail(value)
      ? { authMethod: "email", identifier: normalizeEmail(value) }
      : { error: "invalid_email" };
  }

  if (!/^\+?[\d\s\-().]+$/.test(value)) return { error: "invalid_phone" };
  let digits = value.replace(/\D/g, "");
  if (value.startsWith("+")) {
    if (!digits.startsWith("91")) return { error: "invalid_phone" };
    digits = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return INDIAN_MOBILE_REGEX.test(digits)
    ? { authMethod: "phone", identifier: `+91${digits}` }
    : { error: "invalid_phone" };
}

export default function PhoneLoginScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [identifierInput, setIdentifierInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const isSendingOtpRef = useRef(false);
  // A failed/unusable email sign-in link comes back here as ?authError=.
  const { authError } = useLocalSearchParams<{ authError?: string }>();
  const [errorMessage, setErrorMessage] = useState<string | null>(
    typeof authError === "string" && authError ? authError : null,
  );
  const [fontsLoaded] = useFonts({
    Geist_500Medium,
    Geist_700Bold,
    Geist_800ExtraBold,
  });

  const canSendOtp = Boolean(identifierInput.trim()) && !isSendingOtp;

  const titleSize = Math.round(
    Math.min(32, Math.max(26, windowWidth * 0.078)),
  );
  const logoSize = Math.round(Math.min(112, Math.max(84, windowWidth * 0.24)));

  const handleSendOtp = async () => {
    if (isSendingOtpRef.current) return;

    const parsed = parseLoginIdentifier(identifierInput);
    if ("error" in parsed) {
      setErrorMessage(MESSAGES[parsed.error]);
      return;
    }

    isSendingOtpRef.current = true;
    setIsSendingOtp(true);
    setErrorMessage(null);

    try {
      if (parsed.authMethod === "email") {
        // Existing email → login; new email → Supabase creates the account on verify.
        const result = await sendEmailLoginCode(parsed.identifier);
        if (result.error) {
          setErrorMessage(MESSAGES[classifyOtpSendError(result.cause)]);
          return;
        }
        router.push({
          pathname: "/verify-email",
          params: {
            email: parsed.identifier,
            mode: "login",
            sent: "1",
            identifier: parsed.identifier,
            authMethod: "email",
          },
        } as never);
        return;
      }

      // Existing number → login; new number → Supabase creates the account on verify.
      const { error } = await sendOTP(parsed.identifier);
      if (error) {
        const bucket = classifyOtpSendError(error);
        setErrorMessage(bucket === "failed" ? error.message : MESSAGES[bucket]);
        return;
      }
      router.replace({
        pathname: "/verify-otp",
        params: {
          phone: parsed.identifier,
          identifier: parsed.identifier,
          authMethod: "phone",
        },
      });
    } catch (error) {
      setErrorMessage(MESSAGES[classifyOtpSendError(error)]);
    } finally {
      isSendingOtpRef.current = false;
      setIsSendingOtp(false);
    }
  };

  if (!fontsLoaded) {
    return (
      <View style={[styles.root, styles.fontLoading]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <PhoneLoginBackground appearance="dark">
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.pageContent,
                { paddingBottom: Math.max(insets.bottom, 10) + 16 },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.centerWrapper}>
                <View style={styles.loginContainer}>
                  <View style={styles.brandBlock}>
                    <AskPranaLogo size={logoSize} />
                  </View>

                  <Text style={styles.welcomeLabel}>WELCOME</Text>
                  <Text
                    style={[
                      styles.title,
                      {
                        fontSize: titleSize,
                        lineHeight: Math.round(titleSize * 1.18),
                      },
                    ]}
                  >
                    Enter your email or{"\n"}mobile number
                  </Text>
                  <Text style={styles.subtitle}>
                    We'll send you a one-time password to verify.
                  </Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Email or mobile number</Text>
                    <View
                      style={[
                        styles.inputContainer,
                        inputFocused && styles.inputContainerFocused,
                        errorMessage ? styles.inputContainerError : null,
                      ]}
                    >
                      <TextInput
                        value={identifierInput}
                        onChangeText={(value) => {
                          setIdentifierInput(value);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        editable={!isSendingOtp}
                        placeholder="Enter email or mobile number"
                        placeholderTextColor={colors.placeholder}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="username"
                        textContentType="username"
                        style={styles.input}
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setInputFocused(false)}
                        returnKeyType="send"
                        onSubmitEditing={() => void handleSendOtp()}
                        accessibilityLabel="Email or mobile number"
                      />
                    </View>
                    {errorMessage ? (
                      <Text style={styles.errorText} accessibilityLiveRegion="polite">
                        {errorMessage}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.actions}>
                <Pressable
                  onPress={() => void handleSendOtp()}
                  disabled={!canSendOtp}
                  style={({ pressed }) => [
                    styles.button,
                    {
                      backgroundColor: canSendOtp
                        ? colors.ctaGradientStart
                        : colors.ctaDisabled,
                    },
                    pressed && canSendOtp && styles.buttonPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSendOtp, busy: isSendingOtp }}
                >
                  {canSendOtp ? <PrimaryCtaGradientFill key="enabled" /> : null}
                  {isSendingOtp ? (
                    <View style={styles.buttonContent}>
                      <ActivityIndicator color={colors.ctaDisabledText} size="small" />
                      <Text style={[styles.buttonText, styles.buttonTextDisabled]}>
                        Sending OTP...
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.buttonText, !canSendOtp && styles.buttonTextDisabled]}>
                      SEND OTP →
                    </Text>
                  )}
                </Pressable>

                <Text style={styles.termsText}>
                  By continuing you agree to our Terms of Service
                </Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </PhoneLoginBackground>
    </View>
  );
}


const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  fontLoading: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  keyboardView: {
    flex: 1,
    overflow: "hidden",
  },
  scroll: {
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  centerWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  loginContainer: {
    width: "100%",
    maxWidth: 540,
  },
  brandBlock: {
    alignItems: "center",
    marginBottom: 24,
  },
  welcomeLabel: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
    textAlign: "center",
  },
  title: {
    color: colors.text,
    fontFamily: fonts.extraBold,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    color: colors.textSoft,
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 18,
    textAlign: "center",
  },
  inputGroup: {
    gap: 8,
    marginBottom: 16,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  inputContainer: {
    height: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    overflow: "hidden",
  },
  inputContainerFocused: {
    borderColor: colors.primary,
  },
  inputContainerError: {
    borderColor: colors.error,
  },
  input: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 22,
    ...(Platform.OS === "web"
      ? ({ outlineStyle: "none", outlineWidth: 0 } as object)
      : null),
  },
  errorText: {
    color: colors.error,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    gap: 12,
  },
  button: {
    height: 54,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  buttonText: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  buttonTextDisabled: {
    color: colors.ctaDisabledText,
  },
  termsText: {
    marginTop: 4,
    textAlign: "center",
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 15,
  },
});
