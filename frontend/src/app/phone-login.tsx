import { useRef, useState } from "react";
import {
  Geist_500Medium,
  Geist_700Bold,
  Geist_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/geist";
import { isAuthSessionMissing, sendOTP } from "../services/auth";
import { isValidEmail, normalizeEmail, sendEmailLoginCode } from "../services/profile";
import {
  AUTH_DARK_BACKGROUND,
  PhoneLoginBackground,
  usePhoneLoginWaveInset,
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
  countryCodeBg: "#1B1B1B",
  placeholder: "#6F7777",
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

const isValidIndianMobile = (phone: string) => {
  const cleanedPhone = phone.replace(/\D/g, "");
  return INDIAN_MOBILE_REGEX.test(cleanedPhone);
};

const isOtpRateLimitError = (message: string) =>
  /security purposes|only request this after|after \d+ seconds|rate limit|too many requests/i.test(
    message,
  );

export default function PhoneLoginScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const waveContentInset = usePhoneLoginWaveInset();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const isSendingOtpRef = useRef(false);
  const phoneInputRef = useRef<TextInput>(null);
  // Email login: only for an email already verified on an existing account.
  const [email, setEmail] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  // A failed/unusable email sign-in link comes back here as ?authError=.
  const { authError } = useLocalSearchParams<{ authError?: string }>();
  const [emailError, setEmailError] = useState<string | null>(
    typeof authError === "string" && authError ? authError : null,
  );
  const [emailNotRegistered, setEmailNotRegistered] = useState(false);
  const [isSendingEmailCode, setIsSendingEmailCode] = useState(false);
  const isSendingEmailCodeRef = useRef(false);
  const [fontsLoaded] = useFonts({
    Geist_500Medium,
    Geist_700Bold,
    Geist_800ExtraBold,
  });

  const cleanPhone = phoneNumber.replace(/\D/g, "");
  const isPhoneValid = isValidIndianMobile(phoneNumber);
  const showInvalidPhoneError =
    cleanPhone.length === 10 && !isPhoneValid;
  const canSendOtp = isPhoneValid && !isSendingOtp;
  const canSendEmailCode = Boolean(email.trim()) && !isSendingEmailCode;

  const titleSize = Math.round(
    Math.min(32, Math.max(26, windowWidth * 0.078)),
  );
  const logoSize = Math.round(Math.min(112, Math.max(84, windowWidth * 0.24)));

  const handlePhoneNumberChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 10);
    setPhoneNumber(digitsOnly);
  };

  const handleContinue = async () => {
    if (isSendingOtpRef.current || isSendingOtp) {
      return;
    }

    if (!isValidIndianMobile(phoneNumber)) {
      return;
    }

    isSendingOtpRef.current = true;
    setIsSendingOtp(true);

    try {
      const fullPhone = `+91${phoneNumber}`;

      const { error } = await sendOTP(fullPhone);

      if (error) {
        alert(
          isAuthSessionMissing(error)
            ? "Unable to send OTP. Please try again."
            : isOtpRateLimitError(error.message)
              ? "Please wait a few seconds before requesting another OTP."
              : error.message,
        );
        return;
      }

      router.replace({
        pathname: "/verify-otp",
        params: {
          phone: fullPhone,
        },
      });
    } finally {
      isSendingOtpRef.current = false;
      setIsSendingOtp(false);
    }
  };

  const handleSendEmailCode = async () => {
    if (isSendingEmailCodeRef.current) return;
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) {
      setEmailNotRegistered(false);
      setEmailError("Please enter a valid email address.");
      return;
    }
    isSendingEmailCodeRef.current = true;
    setIsSendingEmailCode(true);
    setEmailError(null);
    setEmailNotRegistered(false);
    try {
      // Never creates an account: unknown emails are refused by Supabase.
      const result = await sendEmailLoginCode(address);
      if (result.error) {
        setEmailNotRegistered(result.notRegistered);
        setEmailError(result.error);
        return;
      }
      router.push({
        pathname: "/verify-email",
        params: { email: address, mode: "login", sent: "1" },
      } as never);
    } finally {
      isSendingEmailCodeRef.current = false;
      setIsSendingEmailCode(false);
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
          <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
            {/* Scrolls so both login methods fit on small screens. */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.pageContent,
                { paddingBottom: Math.max(insets.bottom, 10) + 16 },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View
                style={{ height: waveContentInset }}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />

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
                Enter your mobile{"\n"}number
              </Text>
              <Text style={styles.subtitle}>
                We'll send you a one-time password to verify.
              </Text>

              <Text style={styles.sectionLabel}>LOGIN WITH PHONE</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone number</Text>

                <View
                  style={[
                    styles.phoneInputContainer,
                    phoneFocused && styles.phoneInputContainerFocused,
                  ]}
                >
                  <View style={styles.countryCodeContainer}>
                    <Text style={styles.countryCode}>+91</Text>
                  </View>

                  <TextInput
                    ref={phoneInputRef}
                    value={phoneNumber}
                    onChangeText={handlePhoneNumberChange}
                    placeholder="98765 43210"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    maxLength={10}
                    style={styles.input}
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    returnKeyType="done"
                    onSubmitEditing={handleContinue}
                    onFocus={() => setPhoneFocused(true)}
                    onBlur={() => setPhoneFocused(false)}
                    accessibilityLabel="Phone number"
                  />
                </View>

                {showInvalidPhoneError ? (
                  <Text style={styles.invalidPhoneError}>
                    Invalid number. Please enter a valid Indian mobile number.
                  </Text>
                ) : null}
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={handleContinue}
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
                  accessibilityState={{ disabled: !canSendOtp }}
                >
                  {canSendOtp ? <PrimaryCtaGradientFill key="enabled" /> : null}
                  <Text style={[styles.buttonText, !canSendOtp && styles.buttonTextDisabled]}>
                    {isSendingOtp ? "Sending OTP..." : "SEND PHONE OTP →"}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.orRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={styles.orLine} />
                <Text style={styles.orText}>OR</Text>
                <View style={styles.orLine} />
              </View>

              <Text style={styles.sectionLabel}>LOGIN WITH EMAIL</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email address</Text>
                <View
                  style={[
                    styles.emailInputContainer,
                    emailFocused && styles.phoneInputContainerFocused,
                    emailError ? styles.emailInputContainerError : null,
                  ]}
                >
                  <TextInput
                    value={email}
                    onChangeText={(value) => {
                      setEmail(value);
                      if (emailError) setEmailError(null);
                      if (emailNotRegistered) setEmailNotRegistered(false);
                    }}
                    placeholder="example@gmail.com"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="email-address"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    style={styles.emailInput}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    returnKeyType="send"
                    onSubmitEditing={() => void handleSendEmailCode()}
                    accessibilityLabel="Email address"
                  />
                </View>
                {emailError ? (
                  <Text style={styles.invalidPhoneError} accessibilityLiveRegion="polite">{emailError}</Text>
                ) : (
                  <Text style={styles.emailHint}>
                    For accounts that already added and verified this email in Edit profile.
                  </Text>
                )}
                {emailNotRegistered ? (
                  <Pressable
                    onPress={() => phoneInputRef.current?.focus()}
                    style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.linkButtonText}>LOGIN WITH PHONE</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => void handleSendEmailCode()}
                  disabled={!canSendEmailCode}
                  style={({ pressed }) => [
                    styles.button,
                    {
                      backgroundColor: canSendEmailCode
                        ? colors.ctaGradientStart
                        : colors.ctaDisabled,
                    },
                    pressed && canSendEmailCode && styles.buttonPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSendEmailCode }}
                >
                  {canSendEmailCode ? <PrimaryCtaGradientFill key="email-enabled" /> : null}
                  <Text style={[styles.buttonText, !canSendEmailCode && styles.buttonTextDisabled]}>
                    {isSendingEmailCode ? "Sending OTP..." : "SEND EMAIL OTP →"}
                  </Text>
                </Pressable>

                <Text style={styles.termsText}>
                  By continuing you agree to our Terms of Service
                </Text>
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
  brandBlock: {
    alignItems: "center",
    marginBottom: 18,
  },
  welcomeLabel: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.extraBold,
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSoft,
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 18,
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
  phoneInputContainer: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    overflow: "hidden",
  },
  phoneInputContainerFocused: {
    borderColor: colors.primary,
  },
  emailInputContainer: {
    height: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    overflow: "hidden",
  },
  emailInputContainerError: {
    borderColor: "#F87171",
  },
  emailInput: {
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
  sectionLabel: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  orRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 22,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  orText: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  linkButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  linkButtonText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: 0.6,
  },
  emailHint: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  invalidPhoneError: {
    color: "#F87171",
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  countryCodeContainer: {
    height: "100%",
    minWidth: 72,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.countryCodeBg,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  countryCode: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
  },
  input: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
    ...(Platform.OS === "web"
      ? ({ outlineStyle: "none", outlineWidth: 0 } as object)
      : null),
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
