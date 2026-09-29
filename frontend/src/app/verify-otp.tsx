import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { isAuthSessionMissing, logout, sendOTP, verifyOTP } from "../services/auth";
import {
  ACCOUNT_DELETED_MESSAGE,
  farmerExistsForPhone,
  getCurrentUserProfile,
  isCurrentUserDeleted,
} from "../services/profile";
import { saveFarmerProfile } from "../services/local-profile";
import { useProfile } from "../context/profile-context";
import { supabase } from "../lib/supabase";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  PhoneLoginBackground,
  usePhoneLoginWaveClipHeight,
  usePhoneLoginWaveInset,
} from "../components/phone-login-background";

const colors = {
  teal: "#0F766E",
  tealDark: "#0B5F59",
  background: "#F7F4EF",
  text: "#0B2E32",
  white: "#FFFFFF",
  mutedText: "#3D5553",
  mutedSoft: "#6B7C7A",
  borderEmpty: "#D4C9BB",
  otpEmptyFill: "#F3EDE4",
  shadow: "#0B5F59",
};

function formatPhoneDisplay(phone?: string) {
  if (!phone) {
    return "your mobile number";
  }

  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return phone;
}

const isOtpRateLimitError = (message: string) =>
  /security purposes|only request this after|after \d+ seconds|rate limit|too many requests/i.test(
    message,
  );

export default function VerifyOtpScreen() {
  const router = useRouter();
  const { applyProfileUpdate } = useProfile();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const waveProfile = "tall" as const;
  const waveContentInset = usePhoneLoginWaveInset(waveProfile);
  const waveClipHeight = usePhoneLoginWaveClipHeight(waveProfile);
  const { phone } = useLocalSearchParams<{
    phone: string;
  }>();
  const [otp, setOtp] = useState("");
  const [resendSeconds, setResendSeconds] = useState(30);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const otpInputRef = useRef<TextInput>(null);
  const lastAutoVerifiedRef = useRef("");

  const isOtpValid = otp.length === 6;
  const isResendDisabled = resendSeconds > 0 || isResending;
  const phoneDisplay = formatPhoneDisplay(
    typeof phone === "string" ? phone : undefined,
  );

  const horizontalPadding = 20;
  const otpGap = 8;
  const otpBoxSize = Math.min(
    58,
    Math.max(
      48,
      Math.floor(
        (windowWidth - horizontalPadding * 2 - otpGap * 5) / 6,
      ),
    ),
  );
  const titleSize = Math.round(
    Math.min(32, Math.max(28, windowWidth * 0.076)),
  );

  useEffect(() => {
    if (resendSeconds <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setResendSeconds((seconds) => Math.max(seconds - 1, 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendSeconds]);

  const handleOtpChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 6);
    setOtp(digitsOnly);
  };

  const focusOtpInput = () => {
    const input = otpInputRef.current;
    if (!input) {
      return;
    }

    const alreadyFocused =
      typeof input.isFocused === "function" ? input.isFocused() : false;

    if (alreadyFocused) {
      input.blur();
      requestAnimationFrame(() => {
        otpInputRef.current?.focus();
      });
      return;
    }

    input.focus();
  };

  const handleResendOtp = async () => {
    if (isResending || resendSeconds > 0) {
      return;
    }

    const phoneNumber = typeof phone === "string" ? phone.trim() : "";
    if (!phoneNumber) {
      alert("Phone number is missing. Go back and request OTP again.");
      return;
    }

    setIsResending(true);
    try {
      const { error } = await sendOTP(phoneNumber);
      if (error) {
        alert(
          isAuthSessionMissing(error)
            ? "Unable to resend OTP. Please try again."
            : isOtpRateLimitError(error.message)
              ? "Please wait a few seconds before requesting another OTP."
              : "Unable to resend OTP. Please try again.",
        );
        return;
      }

      setOtp("");
      lastAutoVerifiedRef.current = "";
      setResendSeconds(30);
      alert("OTP resent.");
      requestAnimationFrame(() => {
        otpInputRef.current?.focus();
      });
    } catch {
      alert("Unable to resend OTP. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!isOtpValid || isVerifying) {
      return;
    }

    setIsVerifying(true);

    try {
      const { error } = await verifyOTP(phone as string, otp);

      if (error) {
        alert(
          isAuthSessionMissing(error)
            ? "Unable to verify OTP. Please try again."
            : error.message,
        );
        return;
      }

      if (await isCurrentUserDeleted()) {
        alert(ACCOUNT_DELETED_MESSAGE);
        await logout();
        router.replace("/phone-login" as never);
        return;
      }

      const {
        exists: phoneExists,
        profile: phoneProfile,
        error: phoneLookupError,
      } = await farmerExistsForPhone(phone as string);

      if (phoneLookupError) {
        if (!isAuthSessionMissing(phoneLookupError)) {
          alert(phoneLookupError.message);
        }
        return;
      }

      if (phoneProfile?.isDeleted) {
        alert(ACCOUNT_DELETED_MESSAGE);
        await logout();
        router.replace("/phone-login" as never);
        return;
      }

      if (phoneExists && phoneProfile) {
        await saveFarmerProfile({
          name: phoneProfile.name,
          state: phoneProfile.state ?? "",
          district: phoneProfile.district ?? "",
          language: phoneProfile.language ?? "",
        });
        await applyProfileUpdate({
          name: phoneProfile.name,
          state: phoneProfile.state ?? "",
          district: phoneProfile.district ?? "",
          language: phoneProfile.language ?? "",
          phone: phoneProfile.phone ?? "",
        });
        router.replace("/ask-prana" as never);
        return;
      }

      const { profile: userProfile, error: userProfileError } =
        await getCurrentUserProfile();

      if (userProfileError) {
        if (!isAuthSessionMissing(userProfileError)) {
          alert(userProfileError.message);
        }
        return;
      }

      if (userProfile?.isDeleted) {
        alert(ACCOUNT_DELETED_MESSAGE);
        await logout();
        router.replace("/phone-login" as never);
        return;
      }

      if (userProfile?.name) {
        await saveFarmerProfile({
          name: userProfile.name,
          state: userProfile.state ?? "",
          district: userProfile.district ?? "",
          language: userProfile.language ?? "",
        });
        await applyProfileUpdate({
          name: userProfile.name,
          state: userProfile.state ?? "",
          district: userProfile.district ?? "",
          language: userProfile.language ?? "",
          phone: userProfile.phone ?? "",
        });
        router.replace("/ask-prana" as never);
        return;
      }

      const {
        data: { session: stillSignedIn },
      } = await supabase.auth.getSession();
      if (!stillSignedIn?.user) {
        router.replace("/phone-login" as never);
        return;
      }

      router.replace("/farmer-profile" as never);
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    if (otp.length < 6) {
      lastAutoVerifiedRef.current = "";
      return;
    }

    if (otp.length === 6 && otp !== lastAutoVerifiedRef.current && !isVerifying) {
      lastAutoVerifiedRef.current = otp;
      void handleVerifyOtp();
    }
    // Intentionally depends on otp length/value only for one-shot auto verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.tealDark} />

      <PhoneLoginBackground waveProfile={waveProfile}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
            <View style={styles.page}>
              <View
                style={[
                  styles.headerArea,
                  {
                    height: Math.max(waveClipHeight, waveContentInset),
                    paddingTop: insets.top + 8,
                  },
                ]}
              >
                <View style={styles.headerRow}>
                  <Pressable
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    hitSlop={8}
                  >
                    <Text style={styles.backArrow}>←</Text>
                  </Pressable>

                  <Text style={styles.headerTitle} pointerEvents="none">
                    Verify OTP
                  </Text>

                  <View style={styles.headerSide} />
                </View>
              </View>

              <View style={styles.contentArea}>
                <View style={styles.content}>
                  <Text style={styles.eyebrow}>SECURE VERIFICATION</Text>
                  <Text
                    style={[
                      styles.heading,
                      {
                        fontSize: titleSize,
                        lineHeight: Math.round(titleSize * 1.15),
                      },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    Enter 6-digit OTP
                  </Text>
                  <Text style={styles.sentTo}>Sent to {phoneDisplay}</Text>

                  <Pressable
                    onPress={focusOtpInput}
                    style={styles.otpRowWrap}
                    accessibilityRole="button"
                    accessibilityLabel="OTP verification code"
                  >
                    <View
                      style={[styles.otpRow, { gap: otpGap }]}
                      pointerEvents="none"
                    >
                      {Array.from({ length: 6 }).map((_, index) => {
                        const digit = otp[index] ?? "";
                        const isFilled = digit.length > 0;
                        const isActive =
                          index === otp.length && otp.length < 6;

                        return (
                          <View
                            key={index}
                            style={[
                              styles.otpBox,
                              {
                                width: otpBoxSize,
                                height: otpBoxSize,
                              },
                              (isFilled || isActive) && styles.otpBoxFilled,
                            ]}
                          >
                            <Text style={styles.otpDigit}>{digit}</Text>
                          </View>
                        );
                      })}
                    </View>

                    <TextInput
                      ref={otpInputRef}
                      value={otp}
                      onChangeText={handleOtpChange}
                      autoFocus
                      showSoftInputOnFocus
                      keyboardType="number-pad"
                      inputMode="numeric"
                      maxLength={6}
                      style={styles.otpOverlayInput}
                      textContentType="oneTimeCode"
                      autoComplete="sms-otp"
                      importantForAutofill="yes"
                      returnKeyType="done"
                      onSubmitEditing={handleVerifyOtp}
                      accessibilityLabel="OTP verification code"
                      caretHidden
                      contextMenuHidden={false}
                      pointerEvents="none"
                    />
                  </Pressable>

                  <Text style={styles.expiryText}>
                    OTP expires in 5 minutes
                  </Text>

                  {isVerifying ? (
                    <View style={styles.verifyingRow}>
                      <ActivityIndicator color={colors.teal} />
                      <Text style={styles.verifyingText}>Verifying…</Text>
                    </View>
                  ) : null}

                  <View style={styles.resendContainer}>
                    <Text style={styles.resendLine}>
                      <Text style={styles.resendPrompt}>
                        Didn't receive it?{" "}
                      </Text>
                      <Text
                        onPress={
                          isResendDisabled ? undefined : handleResendOtp
                        }
                        style={[
                          styles.resendAction,
                          isResendDisabled && styles.resendActionDisabled,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isResendDisabled }}
                      >
                        {isResending
                          ? "Sending…"
                          : isResendDisabled
                          ? `Resend OTP in ${resendSeconds}s`
                          : "Resend OTP"}
                      </Text>
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </PhoneLoginBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.tealDark,
    overflow: "hidden",
  },
  keyboardView: {
    flex: 1,
    overflow: "hidden",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  page: {
    flex: 1,
    overflow: "hidden",
  },
  headerArea: {
    justifyContent: "flex-start",
  },
  headerRow: {
    height: 44,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSide: {
    width: 40,
    height: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  backArrow: {
    color: colors.tealDark,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 22,
    marginTop: -1,
  },
  headerTitle: {
    ...StyleSheet.absoluteFill,
    textAlign: "center",
    textAlignVertical: "center",
    color: colors.white,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 44,
  },
  contentArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
  },
  eyebrow: {
    color: colors.teal,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 18,
  },
  heading: {
    color: colors.text,
    fontWeight: "800",
    marginBottom: 16,
  },
  sentTo: {
    color: colors.mutedText,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600",
    marginBottom: 40,
  },
  otpRowWrap: {
    position: "relative",
    marginBottom: 40,
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  otpBox: {
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.borderEmpty,
    backgroundColor: colors.otpEmptyFill,
    alignItems: "center",
    justifyContent: "center",
  },
  otpBoxFilled: {
    borderColor: colors.teal,
    borderWidth: 2,
    backgroundColor: colors.white,
  },
  otpDigit: {
    color: colors.tealDark,
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 34,
  },
  otpOverlayInput: {
    ...StyleSheet.absoluteFill,
    color: "transparent",
    backgroundColor: "transparent",
    fontSize: 1,
    letterSpacing: 0,
    opacity: 0.015,
    zIndex: 2,
    ...(Platform.OS === "web"
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          caretColor: "transparent",
        } as object)
      : null),
  },
  expiryText: {
    color: colors.mutedSoft,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  verifyingRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  verifyingText: {
    color: colors.teal,
    fontSize: 14,
    fontWeight: "700",
  },
  resendContainer: {
    marginTop: 48,
    alignItems: "center",
  },
  resendLine: {
    textAlign: "center",
    fontSize: 16,
    lineHeight: 22,
  },
  resendPrompt: {
    color: colors.mutedText,
    fontWeight: "600",
  },
  resendAction: {
    color: colors.teal,
    fontWeight: "800",
  },
  resendActionDisabled: {
    color: colors.mutedSoft,
    fontWeight: "700",
  },
});
