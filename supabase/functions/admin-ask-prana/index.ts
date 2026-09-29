import { createClient } from "jsr:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getPathParts(req: Request): string[] {
  const url = new URL(req.url);
  // /functions/v1/admin-ask-prana/sessions or /sessions
  const raw = url.pathname.replace(/\/+$/, "");
  const marker = "/admin-ask-prana";
  const idx = raw.indexOf(marker);
  const rest = idx >= 0 ? raw.slice(idx + marker.length) : raw;
  return rest.split("/").filter(Boolean);
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: json({ error: "Missing authorization" }, 401) };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY");

  if (!serviceKey) {
    return { error: json({ error: "Service role key not configured" }, 500) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: adminRow, error: adminError } = await admin
    .from("admins")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return { error: json({ error: "Admin access required" }, 403) };
  }

  return { admin, userId: user.id };
}

type MessageRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  farmer_name: string | null;
  pond_id: string | null;
  pond_name: string | null;
  mode: string | null;
  role: "user" | "assistant";
  content: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  attachments: unknown;
  message_type?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  pond_id: string | null;
  farmer_name: string | null;
  pond_name: string | null;
  mode: string | null;
  title: string | null;
  last_message: string | null;
  last_activity: string | null;
  created_at: string;
  users?: { name?: string | null; phone?: string | null; state?: string | null; district?: string | null } | null;
};

function csvEscape(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireAdmin(req);
    if ("error" in auth && auth.error) {
      return auth.error;
    }

    const { admin } = auth as {
      admin: ReturnType<typeof createClient>;
      userId: string;
    };

    const parts = getPathParts(req);
    const url = new URL(req.url);

    // GET /sessions
    if (req.method === "GET" && parts[0] === "sessions" && parts.length === 1) {
      const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
      const pageSize = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("pageSize") || "25")),
      );
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const search = (url.searchParams.get("search") || "").trim();
      const mode = url.searchParams.get("mode");
      const farmer = url.searchParams.get("farmer");
      const pond = url.searchParams.get("pond");
      const state = url.searchParams.get("state");
      const district = url.searchParams.get("district");
      const fromDate = url.searchParams.get("from");
      const toDate = url.searchParams.get("to");

      let query = admin
        .from("ask_prana_sessions")
        .select(
          `
          id,
          user_id,
          pond_id,
          farmer_name,
          pond_name,
          mode,
          title,
          last_message,
          last_activity,
          created_at
        `,
          { count: "exact" },
        )
        .order("last_activity", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (mode === "generic" || mode === "pond") {
        query = query.eq("mode", mode);
      }
      if (farmer && farmer !== "all") {
        query = query.eq("user_id", farmer);
      }
      if (pond && pond !== "all") {
        query = query.eq("pond_id", pond);
      }
      if (fromDate) {
        query = query.gte("last_activity", `${fromDate}T00:00:00.000Z`);
      }
      if (toDate) {
        query = query.lte("last_activity", `${toDate}T23:59:59.999Z`);
      }

      const { data, error, count } = await query;
      if (error) {
        return json({ error: error.message }, 500);
      }

      const sessions = (data || []) as SessionRow[];

      // Optional state/district filter via joined users
      let filtered = sessions.filter((session) => {
        if (state && state !== "all" && session.users?.state !== state) {
          return false;
        }
        if (
          district &&
          district !== "all" &&
          session.users?.district !== district
        ) {
          return false;
        }
        return true;
      });

      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((session) => {
          const hay = [
            session.id,
            session.farmer_name,
            session.users?.name,
            session.pond_name,
            session.last_message,
            session.title,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
      }

      const sessionIds = filtered.map((s) => s.id);
      const counts = new Map<string, number>();

      if (sessionIds.length > 0) {
        const { data: messageRows } = await admin
          .from("ask_prana_messages")
          .select("session_id")
          .in("session_id", sessionIds);

        for (const row of messageRows || []) {
          const sid = (row as { session_id: string }).session_id;
          counts.set(sid, (counts.get(sid) || 0) + 1);
        }
      }

      const items = filtered.map((session) => {
        const inferredMode =
          session.mode || (session.pond_id ? "pond" : "generic");
        return {
          session_id: session.id,
          farmer_name:
            session.farmer_name || session.users?.name || "Unknown farmer",
          phone: session.users?.phone || "",
          pond_id: session.pond_id,
          pond_name: session.pond_name || (session.pond_id ? "Pond" : "Generic"),
          mode: inferredMode,
          total_messages: counts.get(session.id) || 0,
          last_message: session.last_message || session.title || "",
          last_activity: session.last_activity || session.created_at,
          created_at: session.created_at,
          state: session.users?.state || "",
          district: session.users?.district || "",
        };
      });

      return json({
        items,
        page,
        pageSize,
        total: count ?? items.length,
      });
    }

    // GET /session/:sessionId
    if (
      req.method === "GET" &&
      parts[0] === "session" &&
      parts[1] &&
      parts.length === 2
    ) {
      const sessionId = parts[1];
      const { data: session, error: sessionError } = await admin
        .from("ask_prana_sessions")
        .select(
          `
          id,
          user_id,
          pond_id,
          farmer_name,
          pond_name,
          mode,
          title,
          last_message,
          last_activity,
          created_at
        `,
        )
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError) {
        return json({ error: sessionError.message }, 500);
      }
      if (!session) {
        return json({ error: "Session not found" }, 404);
      }

      const { data: messages, error: messagesError } = await admin
        .from("ask_prana_messages")
        .select(
          `
          id,
          session_id,
          user_id,
          farmer_name,
          pond_id,
          pond_name,
          mode,
          role,
          content,
          created_at,
          metadata,
          attachments,
          message_type,
          file_path,
          file_name,
          mime_type
        `,
        )
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        return json({ error: messagesError.message }, 500);
      }

      const s = session as SessionRow;
      return json({
        session: {
          session_id: s.id,
          farmer_name: s.farmer_name || s.users?.name || "Unknown farmer",
          phone: s.users?.phone || "",
          pond_id: s.pond_id,
          pond_name: s.pond_name || (s.pond_id ? "Pond" : "Generic"),
          mode: s.mode || (s.pond_id ? "pond" : "generic"),
          last_message: s.last_message || "",
          last_activity: s.last_activity || s.created_at,
          created_at: s.created_at,
        },
        messages: ((messages || []) as MessageRow[]).map((m) => ({
          id: m.id,
          session_id: m.session_id,
          role: m.role,
          message: m.content || "",
          created_at: m.created_at,
          mode: m.mode,
          farmer_name: m.farmer_name,
          pond_name: m.pond_name,
          metadata: m.metadata,
          attachments: m.attachments,
          message_type: m.message_type,
          file_path: m.file_path,
          file_name: m.file_name,
          mime_type: m.mime_type,
        })),
      });
    }

    // DELETE /session/:sessionId
    if (
      req.method === "DELETE" &&
      parts[0] === "session" &&
      parts[1] &&
      parts.length === 2
    ) {
      const sessionId = parts[1];
      await admin.from("ask_prana_messages").delete().eq("session_id", sessionId);
      const { error } = await admin
        .from("ask_prana_sessions")
        .delete()
        .eq("id", sessionId);
      if (error) {
        return json({ error: error.message }, 500);
      }
      return json({ ok: true });
    }

    // GET /stats
    if (req.method === "GET" && parts[0] === "stats") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const isoDay = startOfDay.toISOString();

      const [{ count: messagesToday }, { count: sessionsToday }, { data: recent }, { data: allMessages }] =
        await Promise.all([
          admin
            .from("ask_prana_messages")
            .select("id", { count: "exact", head: true })
            .gte("created_at", isoDay),
          admin
            .from("ask_prana_sessions")
            .select("id", { count: "exact", head: true })
            .gte("created_at", isoDay),
          admin
            .from("ask_prana_sessions")
            .select(
              `
              id,
              farmer_name,
              pond_name,
              mode,
              pond_id,
              last_message,
              last_activity,
              created_at
            `,
            )
            .order("last_activity", { ascending: false, nullsFirst: false })
            .limit(10),
          admin
            .from("ask_prana_messages")
            .select("user_id, pond_id, farmer_name, pond_name")
            .not("user_id", "is", null)
            .limit(5000),
        ]);

      const farmerCounts = new Map<string, { name: string; count: number }>();
      const pondCounts = new Map<string, { name: string; count: number }>();

      for (const row of allMessages || []) {
        const r = row as {
          user_id: string | null;
          pond_id: string | null;
          farmer_name: string | null;
          pond_name: string | null;
        };
        if (r.user_id) {
          const prev = farmerCounts.get(r.user_id) || {
            name: r.farmer_name || "Farmer",
            count: 0,
          };
          prev.count += 1;
          if (r.farmer_name) prev.name = r.farmer_name;
          farmerCounts.set(r.user_id, prev);
        }
        if (r.pond_id) {
          const prev = pondCounts.get(r.pond_id) || {
            name: r.pond_name || "Pond",
            count: 0,
          };
          prev.count += 1;
          if (r.pond_name) prev.name = r.pond_name;
          pondCounts.set(r.pond_id, prev);
        }
      }

      const topFarmers = [...farmerCounts.entries()]
        .map(([id, v]) => ({ id, name: v.name, messages: v.count }))
        .sort((a, b) => b.messages - a.messages)
        .slice(0, 5);

      const topPonds = [...pondCounts.entries()]
        .map(([id, v]) => ({ id, name: v.name, messages: v.count }))
        .sort((a, b) => b.messages - a.messages)
        .slice(0, 5);

      const latest = ((recent || []) as SessionRow[]).map((session) => ({
        session_id: session.id,
        farmer_name:
          session.farmer_name || session.users?.name || "Unknown farmer",
        pond_name: session.pond_name || (session.pond_id ? "Pond" : "Generic"),
        mode: session.mode || (session.pond_id ? "pond" : "generic"),
        last_message: session.last_message || "",
        last_activity: session.last_activity || session.created_at,
      }));

      return json({
        messagesToday: messagesToday || 0,
        sessionsToday: sessionsToday || 0,
        latestSessions: latest,
        topFarmers,
        topPonds,
      });
    }

    // GET /export
    if (req.method === "GET" && parts[0] === "export") {
      const { data: messages, error } = await admin
        .from("ask_prana_messages")
        .select(
          `
          session_id,
          farmer_name,
          pond_name,
          mode,
          role,
          content,
          created_at,
          pond_id
        `,
        )
        .order("created_at", { ascending: true })
        .limit(10000);

      if (error) {
        return json({ error: error.message }, 500);
      }

      const bySession = new Map<
        string,
        {
          farmer: string;
          pond: string;
          mode: string;
          userMessage: string;
          assistantResponse: string;
          timestamp: string;
        }
      >();

      for (const row of (messages || []) as MessageRow[]) {
        const key = row.session_id;
        const existing = bySession.get(key) || {
          farmer: row.farmer_name || "",
          pond: row.pond_name || (row.pond_id ? "Pond" : "Generic"),
          mode: row.mode || (row.pond_id ? "pond" : "generic"),
          userMessage: "",
          assistantResponse: "",
          timestamp: row.created_at,
        };

        if (row.role === "user" && !existing.userMessage) {
          existing.userMessage = row.content || "";
          existing.timestamp = row.created_at;
        }
        if (row.role === "assistant") {
          existing.assistantResponse = row.content || "";
          existing.timestamp = row.created_at;
        }
        if (row.farmer_name) existing.farmer = row.farmer_name;
        if (row.pond_name) existing.pond = row.pond_name;
        bySession.set(key, existing);
      }

      const header = [
        "Session ID",
        "Farmer",
        "Pond",
        "Mode",
        "User Message",
        "Assistant Response",
        "Timestamp",
      ];
      const lines = [header.join(",")];
      for (const [sessionId, row] of bySession.entries()) {
        lines.push(
          [
            sessionId,
            row.farmer,
            row.pond,
            row.mode,
            row.userMessage,
            row.assistantResponse,
            row.timestamp,
          ]
            .map((cell) => csvEscape(String(cell ?? "")))
            .join(","),
        );
      }

      return new Response(lines.join("\n"), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": 'attachment; filename="ask-prana-export.csv"',
        },
      });
    }

    if (req.method === "GET" && parts[0] === "expenses" && parts.length === 1) {
      const [cycles, ponds, users, pondExpenses, cycleExpenses] = await Promise.all([
        admin.from("crop_cycles").select("*"),
        admin.from("ponds").select("id, name, user_id"),
        admin.from("users").select("id, name, district, state"),
        admin.from("pond_expenses").select("*"),
        admin.from("cycle_expenses").select("*"),
      ]);

      if (cycles.error) {
        return json({ error: cycles.error.message }, 500);
      }
      if (ponds.error) {
        return json({ error: ponds.error.message }, 500);
      }
      if (users.error) {
        return json({ error: users.error.message }, 500);
      }

      return json({
        cycles: cycles.data || [],
        ponds: ponds.data || [],
        users: users.data || [],
        pond_expenses: pondExpenses.error ? [] : pondExpenses.data || [],
        cycle_expenses: cycleExpenses.error ? [] : cycleExpenses.data || [],
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
