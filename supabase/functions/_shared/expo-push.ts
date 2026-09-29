/**
 * Shared Expo Push API helpers for Edge Functions.
 * Ticket "ok" means Expo accepted the message — not that the tray showed it.
 */

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
};

export type ExpoPushTicketResult = {
  token: string;
  status: "sent" | "failed";
  id?: string;
  error?: string;
  invalidToken?: boolean;
};

export type ExpoReceiptResult = {
  id: string;
  status: "ok" | "error" | "unknown";
  error?: string;
  invalidToken?: boolean;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

function isInvalidTokenError(err: string | undefined): boolean {
  if (!err) return false;
  const lower = err.toLowerCase();
  return (
    err === "DeviceNotRegistered" ||
    err === "InvalidCredentials" ||
    lower.includes("not registered") ||
    lower.includes("devicenotregistered")
  );
}

export async function sendExpoPush(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicketResult[]> {
  if (messages.length === 0) return [];

  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN")?.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const payload = messages.map((m) => ({
    to: m.to,
    sound: m.sound === null ? undefined : (m.sound ?? "default"),
    title: m.title,
    body: m.body,
    data: m.data ?? {},
    priority: m.priority ?? "high",
    channelId: m.channelId,
    ttl: m.ttl,
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    return messages.map((m) => ({
      token: m.to,
      status: "failed" as const,
      error: `Expo HTTP ${response.status}: ${text.slice(0, 200)}`,
    }));
  }

  const body = (await response.json()) as {
    data?: Array<{
      status?: string;
      id?: string;
      message?: string;
      details?: { error?: string };
    }>;
  };

  const results = body.data ?? [];
  return messages.map((m, i) => {
    const item = results[i];
    const err = item?.details?.error ?? item?.message;
    if (item?.status === "ok") {
      return {
        token: m.to,
        status: "sent" as const,
        id: item.id,
      };
    }
    return {
      token: m.to,
      status: "failed" as const,
      id: item?.id,
      error: err ?? "Expo ticket error",
      invalidToken: isInvalidTokenError(err),
    };
  });
}

export async function fetchExpoReceipts(
  ticketIds: string[],
): Promise<ExpoReceiptResult[]> {
  const ids = ticketIds.filter(Boolean);
  if (ids.length === 0) return [];

  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN")?.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(EXPO_RECEIPTS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    const text = await response.text();
    return ids.map((id) => ({
      id,
      status: "unknown" as const,
      error: `Expo receipts HTTP ${response.status}: ${text.slice(0, 200)}`,
    }));
  }

  const body = (await response.json()) as {
    data?: Record<
      string,
      {
        status?: string;
        message?: string;
        details?: { error?: string };
      }
    >;
  };

  const data = body.data ?? {};
  return ids.map((id) => {
    const item = data[id];
    if (!item) {
      return { id, status: "unknown" as const, error: "receipt_pending" };
    }
    if (item.status === "ok") {
      return { id, status: "ok" as const };
    }
    const err = item.details?.error ?? item.message;
    return {
      id,
      status: "error" as const,
      error: err,
      invalidToken: isInvalidTokenError(err),
    };
  });
}

/** Quiet hours helper (local wall-clock using UTC offset minutes). */
export function isWithinQuietHours(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined,
  utcOffsetMinutes = 330,
): boolean {
  if (!start || !end) return false;
  const parse = (value: string) => {
    const [h, m] = value.split(":").map((p) => Number(p));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const startMin = parse(start);
  const endMin = parse(end);
  if (startMin == null || endMin == null) return false;

  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const current = local.getUTCHours() * 60 + local.getUTCMinutes();

  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return current >= startMin && current < endMin;
  }
  return current >= startMin || current < endMin;
}

export function shouldSendCategoryPush(params: {
  categoryEnabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  urgent?: boolean;
  now?: Date;
}): boolean {
  if (!params.categoryEnabled) return false;
  if (params.urgent) return true;
  const inQuiet = isWithinQuietHours(
    params.now ?? new Date(),
    params.quietHoursStart,
    params.quietHoursEnd,
  );
  return !inQuiet;
}
