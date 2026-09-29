import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { useProfile } from "../context/profile-context";
import { supabase } from "../lib/supabase";
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
} from "../services/profile";

const colors = {
  background: "#171717",
  card: "#212121",
  border: "#363636",
  text: "#F5F5F5",
  muted: "#A0A0A0",
  primary: "#4F8CF7",
};

export default function EditProfileScreen() {
  const router = useRouter();
  const { applyProfileUpdate } = useProfile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [district, setDistrict] = useState("");
  const [language, setLanguage] = useState("English");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      router.replace("/phone-login" as never);
      return;
    }

    const { profile, error } = await getCurrentUserProfile();
    if (error) {
      Alert.alert("Unable to load profile", error.message);
      setLoading(false);
      return;
    }

    setEmail(user.email ?? "");
    setName(profile?.name ?? "");
    setPhone(profile?.phone ?? user.phone ?? "");
    setState(profile?.state ?? "");
    setDistrict(profile?.district ?? "");
    setLanguage(profile?.language ?? "English");
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter your full name.");
      return;
    }
    setSaving(true);
    const { error } = await updateCurrentUserProfile({
      name: name.trim(),
      phone: phone.trim(),
      state: state.trim(),
      district: district.trim(),
      language: language.trim() || "English",
    });
    setSaving(false);
    if (error) {
      Alert.alert("Unable to save profile", error.message);
      return;
    }
    const { profile: savedProfile, error: reloadError } = await getCurrentUserProfile();
    if (reloadError || !savedProfile) {
      Alert.alert("Profile saved", "Your changes were saved, but the profile could not be refreshed yet.");
      return;
    }
    await applyProfileUpdate({
      name: savedProfile.name,
      state: savedProfile.state,
      district: savedProfile.district,
      language: savedProfile.language,
      phone: savedProfile.phone ?? "",
      avatarUrl: savedProfile.avatarUrl ?? null,
      avatarUpdatedAt: savedProfile.avatarUpdatedAt ?? null,
    });
    Alert.alert("Profile updated", "Your profile changes have been saved.");
    router.back();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Edit profile</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.caption}>Your account details</Text>
        <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Email" value={email} editable={false} keyboardType="email-address" />
        <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="State" value={state} onChangeText={setState} autoCapitalize="words" />
        <Field label="District" value={district} onChangeText={setDistrict} autoCapitalize="words" />
        <Field label="Language" value={language} onChangeText={setLanguage} autoCapitalize="words" />
        <Pressable onPress={() => void save()} disabled={saving} style={[styles.saveButton, saving && styles.saveButtonDisabled]} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.text} /> : <Text style={styles.saveText}>Save changes</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, editable = true, ...inputProps }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...inputProps} editable={editable} style={[styles.input, !editable && styles.inputDisabled]} placeholderTextColor={colors.muted} /></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { height: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  title: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: "600" },
  content: { width: "100%", maxWidth: 520, alignSelf: "center", padding: 20, gap: 16 },
  caption: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: "400", marginBottom: 4 },
  field: { gap: 7 },
  label: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "500" },
  input: { minHeight: 46, color: colors.text, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, fontSize: 15, lineHeight: 21, fontWeight: "400" },
  inputDisabled: { color: colors.muted, opacity: 0.8 },
  saveButton: { minHeight: 46, marginTop: 8, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  saveButtonDisabled: { opacity: 0.6 },
  saveText: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
