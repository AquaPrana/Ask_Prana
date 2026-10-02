const WIDGET_API = "https://control.msg91.com/api/v5/widget";

const IP_SECURITY_MESSAGE =
  "MSG91 blocked this network. Authkey IP Security can stay off. Open OTP, then Tokens, open your token, and clear any blocked IP on the IPs tab. Also turn off Captcha on the widget, then try again.";

type Msg91Body = {
  type?: unknown;
  status?: unknown;
  message?: unknown;
  code?: unknown;
  request_id?: unknown;
  requestId?: unknown;
  reqId?: unknown;
  "access-token"?: unknown;
  access_token?: unknown;
  accessToken?: unknown;
};

function widgetConfig(): { widgetId: string; tokenAuth: string } | null {
  const widgetId = (process.env.EXPO_PUBLIC_MSG91_WIDGET_ID ?? "").replace(/"/g, "").trim();
  const tokenAuth = (process.env.EXPO_PUBLIC_MSG91_WIDGET_TOKEN ?? "").replace(/"/g, "").trim();
  if (!widgetId || !tokenAuth) return null;
  return { widgetId, tokenAuth };
}

export function toMsg91Mobile(phone: string): string | null {
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

function isSuccess(body: Msg91Body | null): boolean {
  return String(body?.type ?? body?.status ?? "").toLowerCase() === "success";
}

function failureText(body: Msg91Body | null, fallback: string): string {
  const text = `${body?.message ?? ""} ${body?.code ?? ""}`.toLowerCase();
  if (/ipblocked|ip blocked|ip security/.test(text)) return IP_SECURITY_MESSAGE;
  if (/limit|too many|rate|max retry|maximum/.test(text)) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (/expired/.test(text)) return "expired";
  if (/invalid otp|otp invalid|wrong otp|not match|incorrect|does not match/.test(text)) return "invalid";
  return fallback;
}

async function widgetPost(path: string, payload: Record<string, unknown>): Promise<Msg91Body | null> {
  const result = await fetch(`${WIDGET_API}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await result.json().catch(() => null) as Msg91Body | null;
}

function requestIdFrom(body: Msg91Body | null): string {
  if (!body) return "";
  for (const value of [body.message, body.request_id, body.requestId, body.reqId]) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (/^[A-Za-z0-9_-]{8,128}$/.test(trimmed)) return trimmed;
  }
  return "";
}

export async function sendMsg91Otp(
  phone: string,
  platform: "web" | "mobile",
  reqId?: string,
): Promise<{ reqId: string }> {
  const credentials = widgetConfig();
  if (!credentials) throw new Error("OTP service is not configured.");
  const identifier = toMsg91Mobile(phone);
  if (!identifier) throw new Error("Please enter a valid 10-digit mobile number.");

  if (reqId && /^[A-Za-z0-9_-]{8,128}$/.test(reqId)) {
    const retried = await widgetPost("/retryOtp", { ...credentials, reqId });
    if (isSuccess(retried)) return { reqId };
  }

  const primary = platform === "web" ? "/sendOtp" : "/sendOtpMobile";
  const secondary = primary === "/sendOtp" ? "/sendOtpMobile" : "/sendOtp";
  let sent = await widgetPost(primary, { ...credentials, identifier });
  if (!isSuccess(sent) && !/ipblocked/i.test(String(sent?.message ?? ""))) {
    const next = await widgetPost(secondary, { ...credentials, identifier });
    if (isSuccess(next) || next) sent = isSuccess(next) ? next : sent;
  }
  if (!isSuccess(sent)) throw new Error(failureText(sent, "Unable to send OTP. Please try again."));
  const issuedReqId = requestIdFrom(sent);
  if (!issuedReqId) throw new Error("Unable to send OTP. Please try again.");
  return { reqId: issuedReqId };
}

function accessTokenFrom(body: Msg91Body | null): string {
  if (!body) return "";
  const jwt = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  const queue: unknown[] = [body];
  while (queue.length) {
    const value = queue.shift();
    if (typeof value === "string") {
      const match = value.match(jwt);
      if (match) return match[0];
      continue;
    }
    if (value && typeof value === "object") queue.push(...Object.values(value as Record<string, unknown>));
  }
  return "";
}

/** Asks MSG91 to check the code. The access token is verified again on the server. */
export async function verifyMsg91Otp(reqId: string, otp: string): Promise<{ accessToken: string }> {
  const credentials = widgetConfig();
  if (!credentials) throw new Error("OTP service is not configured.");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(reqId) || !/^\d{4,8}$/.test(otp)) {
    throw new Error("Please request a new OTP.");
  }
  const verified = await widgetPost("/verifyOtp", { ...credentials, reqId, otp });
  if (!isSuccess(verified)) throw new Error(failureText(verified, "Unable to verify OTP. Please try again."));
  const accessToken = accessTokenFrom(verified);
  if (!accessToken) throw new Error("Verification failed. Please request a new code.");
  return { accessToken };
}

export async function sendMsg91EmailOtp(email: string, reqId?: string): Promise<{ reqId: string }> {
  const credentials = widgetConfig();
  if (!credentials) throw new Error("OTP service is not configured.");
  const identifier = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    throw new Error("Please enter a valid email address.");
  }

  if (reqId && /^[A-Za-z0-9_-]{8,128}$/.test(reqId)) {
    const retried = await widgetPost("/retryOtp", { ...credentials, reqId });
    if (isSuccess(retried)) return { reqId };
  }

  const sent = await widgetPost("/sendOtp", { ...credentials, identifier });
  if (!isSuccess(sent)) throw new Error(failureText(sent, "Unable to send the verification code. Please try again."));
  const issuedReqId = requestIdFrom(sent);
  if (!issuedReqId) throw new Error("Unable to send the verification code. Please try again.");
  return { reqId: issuedReqId };
}
