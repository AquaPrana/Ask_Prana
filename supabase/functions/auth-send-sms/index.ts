import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type SmsHookEvent = {
  user?: { phone?: string | null };
  sms?: { otp?: string | null };
};

function hookSecret(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value.replace(/^v1,whsec_/, "") : null;
}

function normalizeIndianMobile(phone: string): string | null {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!digits.startsWith("91")) return null;
    digits = digits.slice(2);
  } else if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : null;
}

function failure(status = 500) {
  // Supabase Auth needs a non-2xx response to abort sending an undelivered OTP.
  // Never include provider response details, OTPs, or secrets in this response.
  return new Response(JSON.stringify({ error: { message: "Unable to send verification code." } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return failure(405);

  const secret = hookSecret("SEND_SMS_HOOK_SECRET");
  const authkey = Deno.env.get("MSG91_AUTHKEY")?.trim();
  const templateId = Deno.env.get("MSG91_SMS_TEMPLATE_ID")?.trim();
  const otpVariable = Deno.env.get("MSG91_SMS_OTP_VARIABLE")?.trim() || "otp";
  if (!secret || !authkey || !templateId) return failure();

  try {
    const payload = await req.text();
    const event = new Webhook(secret).verify(
      payload,
      Object.fromEntries(req.headers),
    ) as SmsHookEvent;
    const mobile = event.user?.phone ? normalizeIndianMobile(event.user.phone) : null;
    const otp = event.sms?.otp?.trim();
    if (!mobile || !otp) return failure(400);

    const response = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        authkey,
      },
      body: JSON.stringify({
        template_id: templateId,
        recipients: [{ mobiles: mobile, [otpVariable]: otp }],
      }),
    });

    if (!response.ok) return failure();
    const data = await response.json().catch(() => null) as { type?: unknown; message?: unknown } | null;
    if (data?.type && String(data.type).toLowerCase() !== "success") return failure();

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Signature failures and provider/network errors intentionally share one safe response.
    return failure(401);
  }
});
