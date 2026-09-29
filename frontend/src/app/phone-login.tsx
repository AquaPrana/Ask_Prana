import { useRef, useState } from "react";
import {
  Geist_500Medium,
  Geist_700Bold,
  Geist_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/geist";
import { isAuthSessionMissing, sendOTP } from "../services/auth";
import {
  PhoneLoginBackground,
  usePhoneLoginWaveInset,
} from "../components/phone-login-background";
import { PrimaryCtaGradientFill } from "../components/primary-cta-gradient";
import {
  PRIMARY_CTA_DISABLED,
  PRIMARY_CTA_START,
} from "../constants/primary-cta";

import {
  ActivityIndicator,
  Image,
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
import { useRouter } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

/** Horizontal AquaPrana wordmark (infinity mark + tagline baked in). */
const AQUAPRANA_WORDMARK = require("../../assets/images/aquaprana-wordmark.png");

const colors = {
  primary: "#0F766E",
  primaryDark: "#0B5F59",
  primaryBright: "#2DD4BF",
  background: "#F7F4EF",
  white: "#FFFFFF",
  text: "#0B2E32",
  textSoft: "#3D5553",
  muted: "#6B7C7A",
  border: "#B8D9D3",
  countryCodeBg: "#F3EDE4",
  placeholder: "#9CA8A6",
  ctaDisabled: PRIMARY_CTA_DISABLED,
  ctaGradientStart: PRIMARY_CTA_START,
  shadow: "#0B5F59",
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
  const isSendingOtpRef = useRef(false);
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

  const titleSize = Math.round(
    Math.min(32, Math.max(26, windowWidth * 0.078)),
  );
  // Wordmark aspect ~2172x724
  const logoWidth = Math.round(
    Math.min(300, Math.max(240, windowWidth * 0.72)),
  );
  const logoHeight = Math.round(logoWidth * (724 / 2172));

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

  if (!fontsLoaded) {
    return (
      <View style={[styles.root, styles.fontLoading]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />

      <PhoneLoginBackground>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
            <View
              style={[
                styles.pageContent,
                { paddingBottom: Math.max(insets.bottom, 10) },
              ]}
            >
              <View
                style={{ height: waveContentInset }}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />

              <View style={styles.brandBlock}>
                <Image
                  source={AQUAPRANA_WORDMARK}
                  style={{ width: logoWidth, height: logoHeight }}
                  resizeMode="contain"
                  accessibilityLabel="AquaPrana"
                />
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone number</Text>

                <View style={styles.phoneInputContainer}>
                  <View style={styles.countryCodeContainer}>
                    <Text style={styles.countryCode}>+91</Text>
                  </View>

                  <TextInput
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
                  <PrimaryCtaGradientFill
                    key={canSendOtp ? "enabled" : "disabled"}
                    disabled={!canSendOtp}
                  />
                  <Text style={styles.buttonText}>
                    {isSendingOtp ? "Sending OTP..." : "SEND OTP →"}
                  </Text>
                </Pressable>

                <Text style={styles.termsText}>
                  By continuing you agree to our Terms of Service
                </Text>
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
    backgroundColor: colors.primaryDark,
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
  pageContent: {
    flex: 1,
    paddingHorizontal: 20,
    overflow: "hidden",
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
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  invalidPhoneError: {
    color: "#DC2626",
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
    color: colors.primaryDark,
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
  },
  input: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 14,
    color: colors.textSoft,
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
    shadowOpacity: 0.18,
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
  termsText: {
    marginTop: 4,
    textAlign: "center",
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 15,
  },
});
