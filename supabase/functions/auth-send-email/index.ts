import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type EmailHookEvent = {
  user?: { email?: string | null; new_email?: string | null };
  email_data?: {
    token?: string | null;
    token_new?: string | null;
    email_action_type?: string | null;
  };
};

function hookSecret(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value.replace(/^v1,whsec_/, "") : null;
}

function validEmail(value: string | null | undefined): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
}

function failure(status = 500) {
  // Do not disclose signature, provider, template, or OTP details to Auth clients.
  return new Response(JSON.stringify({ error: { message: "Unable to send verification email." } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return failure(405);

  const secret = hookSecret("SEND_EMAIL_HOOK_SECRET");
  const authkey = Deno.env.get("MSG91_AUTHKEY")?.trim();
  const templateId = Deno.env.get("MSG91_EMAIL_TEMPLATE_ID")?.trim();
  const from = Deno.env.get("MSG91_EMAIL_FROM")?.trim();
  const domain = Deno.env.get("MSG91_EMAIL_DOMAIN")?.trim();
  const otpVariable = Deno.env.get("MSG91_EMAIL_OTP_VARIABLE")?.trim() || "otp";
  if (!secret || !authkey || !templateId || !from || !domain) return failure();

  try {
    const payload = await req.text();
    const event = new Webhook(secret).verify(
      payload,
      Object.fromEntries(req.headers),
    ) as EmailHookEvent;
    const emailData = event.email_data;

    // Secure Email Change sends two distinct codes. Keep each code bound to the
    // address assigned by Supabase's documented hook payload semantics.
    const deliveries: Array<{ email: string; otp: string }> = [];
    if (validEmail(event.user?.email) && emailData?.token?.trim()) {
      deliveries.push({ email: event.user.email.trim().toLowerCase(), otp: emailData.token.trim() });
    }
    if (validEmail(event.user?.new_email) && emailData?.token_new?.trim()) {
      deliveries.push({ email: event.user.new_email.trim().toLowerCase(), otp: emailData.token_new.trim() });
    }
    if (deliveries.length === 0) return failure(400);

    const response = await fetch("https://control.msg91.com/api/v5/email/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        authkey,
      },
      body: JSON.stringify({
        from: { email: from },
        domain,
        template_id: templateId,
        recipients: deliveries.map(({ email, otp }) => ({
          to: [{ email }],
          variables: { [otpVariable]: otp },
        })),
      }),
    });

    if (!response.ok) return failure();
    const data = await response.json().catch(() => null) as { type?: unknown } | null;
    if (data?.type && String(data.type).toLowerCase() !== "success") return failure();
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return failure(401);
  }
});
