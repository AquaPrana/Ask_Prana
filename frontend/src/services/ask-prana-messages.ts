import type { ChatMessage, ChatMessageType } from "../context/ask-prana-chat-context";
import { getAskPranaFileUrl } from "../lib/ask-prana-files";
import { supabase } from "../lib/supabase";

export type AskPranaMessageRow = {
  id: string;
  session_id: string | null;
  user_id?: string | null;
  pond_id?: string | null;
  farmer_name?: string | null;
  pond_name?: string | null;
  mode?: "generic" | "pond" | null;
  role: "user" | "assistant";
  message_type?: ChatMessageType | null;
  content: string | null;
  file_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  metadata?: Record<string, unknown> | null;
  attachments?: unknown;
  created_at: string;
};

export type SaveAskPranaMessageInput = {
  sessionId: string;
  userId: string;
  pondId?: string | null;
  farmerName?: string | null;
  pondName?: string | null;
  mode?: "generic" | "pond";
  role: "user" | "assistant";
  messageType: ChatMessageType;
  content?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AskPranaSessionSummary = {
  id: string;
  pondId: string | null;
  title: string;
  preview: string;
  createdAt: string;
  lastActivity: string;
};

const MESSAGE_SELECT =
  "id, session_id, user_id, pond_id, farmer_name, pond_name, mode, role, message_type, content, file_path, file_name, mime_type, metadata, attachments, created_at";

const MESSAGE_SELECT_MINIMAL = "id, session_id, role, content, created_at";

function getPublicFileUrl(filePath: string | null | undefined) {
  if (!filePath) {
    return null;
  }

  for (const bucket of ["ask-prana-files", "aquagpt-files"] as const) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
    if (data.publicUrl) {
      return data.publicUrl;
    }
  }

  return null;
}

function titleFromMessage(content?: string | null) {
  const cleaned = (content ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "New conversation";
  }
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

function previewFromContent(content?: string | null) {
  const cleaned = (content ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

export async function mapRowToChatMessage(
  row: AskPranaMessageRow,
): Promise<ChatMessage> {
  const messageType = normalizeMessageType(row);
  const fileUrl =
    (await getAskPranaFileUrl(row.file_path ?? null)) ??
    getPublicFileUrl(row.file_path);

  return {
    id: row.id,
    role: row.role,
    text: row.content ?? "",
    messageType,
    fileUrl,
    filePath: row.file_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    transcript: messageType === "audio" ? row.content : null,
    createdAt: row.created_at,
  };
}

function normalizeMessageType(row: AskPranaMessageRow): ChatMessageType {
  const rawType = (row.message_type ?? "text").toLowerCase();

  if (rawType === "image" || rawType === "document" || rawType === "audio") {
    return rawType;
  }

  if (row.file_path?.startsWith("images/")) {
    return "image";
  }

  if (row.file_path?.startsWith("documents/")) {
    return "document";
  }

  if (row.file_path?.startsWith("audio/")) {
    return "audio";
  }

  if (row.mime_type?.startsWith("image/")) {
    return "image";
  }

  return "text";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAskPranaUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Always create a brand-new conversation session for the pond (or generic). */
export async function createAskPranaSession(
  userId: string,
  pondId: string | null,
  options?: {
    title?: string | null;
    language?: string | null;
    farmerName?: string | null;
    pondName?: string | null;
    mode?: "generic" | "pond";
  },
): Promise<{ sessionId: string | null; error: Error | null }> {
  if (!isValidAskPranaUuid(userId)) {
    return {
      sessionId: null,
      error: new Error(
        userId ? "Invalid user_id." : "No active session. Please sign in again.",
      ),
    };
  }

  if (
    pondId != null &&
    pondId !== "" &&
    !isValidAskPranaUuid(pondId)
  ) {
    return { sessionId: null, error: new Error("Invalid pond_id.") };
  }

  const mode =
    options?.mode ?? (isValidAskPranaUuid(pondId) ? "pond" : "generic");

  // Never send "undefined" / "" — omit pond_id for Generic (null column).
  const row: Record<string, unknown> = {
    user_id: userId,
    language: options?.language?.trim() || "English",
    last_activity: new Date().toISOString(),
    mode,
  };

  if (isValidAskPranaUuid(pondId)) {
    row.pond_id = pondId;
  } else {
    row.pond_id = null;
  }

  if (options?.farmerName?.trim()) {
    row.farmer_name = options.farmerName.trim();
  }
  if (options?.pondName?.trim()) {
    row.pond_name = options.pondName.trim();
  } else if (mode === "generic") {
    row.pond_name = "Generic";
  }

  if (options?.title?.trim()) {
    row.title = options.title.trim();
  }

  const { data: created, error: createError } = await supabase
    .from("ask_prana_sessions")
    .insert(row)
    .select("id")
    .single();

  if (createError) {
    // Fallback if title/last_activity columns are not yet migrated.
    const fallbackRow: Record<string, unknown> = {
      user_id: userId,
      language: options?.language?.trim() || "English",
      pond_id: isValidAskPranaUuid(pondId) ? pondId : null,
    };

    const fallback = await supabase
      .from("ask_prana_sessions")
      .insert(fallbackRow)
      .select("id")
      .single();

    if (fallback.error) {
      return { sessionId: null, error: new Error(fallback.error.message) };
    }

    if (!isValidAskPranaUuid(fallback.data?.id)) {
      return {
        sessionId: null,
        error: new Error("Session create returned an invalid id."),
      };
    }

    return { sessionId: fallback.data.id, error: null };
  }

  if (!isValidAskPranaUuid(created?.id)) {
    return {
      sessionId: null,
      error: new Error("Session create returned an invalid id."),
    };
  }

  return { sessionId: created.id, error: null };
}

/**
 * Get latest session for pond without creating one.
 * Used when switching ponds to restore the most recent conversation.
 */
export async function getLatestAskPranaSession(
  userId: string,
  pondId: string | null,
): Promise<{ sessionId: string | null; error: Error | null }> {
  let query = supabase
    .from("ask_prana_sessions")
    .select("id")
    .eq("user_id", userId)
    .order("last_activity", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  query = pondId ? query.eq("pond_id", pondId) : query.is("pond_id", null);

  const { data, error } = await query.maybeSingle();

  if (error) {
    // Fallback ordering if last_activity is missing.
    let fallbackQuery = supabase
      .from("ask_prana_sessions")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    fallbackQuery = pondId
      ? fallbackQuery.eq("pond_id", pondId)
      : fallbackQuery.is("pond_id", null);

    const fallback = await fallbackQuery.maybeSingle();
    if (fallback.error) {
      return { sessionId: null, error: new Error(fallback.error.message) };
    }
    return { sessionId: fallback.data?.id ?? null, error: null };
  }

  return { sessionId: data?.id ?? null, error: null };
}

/** @deprecated Prefer createAskPranaSession / getLatestAskPranaSession. */
export async function getOrCreateAskPranaSession(
  userId: string,
  pondId: string | null,
): Promise<{ sessionId: string | null; error: Error | null }> {
  const latest = await getLatestAskPranaSession(userId, pondId);
  if (latest.error) {
    return latest;
  }
  if (latest.sessionId) {
    return latest;
  }
  return createAskPranaSession(userId, pondId);
}

export async function fetchAskPranaMessages(
  sessionId: string,
  userId?: string,
  pondId?: string | null,
): Promise<{ messages: ChatMessage[]; error: Error | null }> {
  let fullQuery = supabase
    .from("ask_prana_messages")
    .select(MESSAGE_SELECT)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (userId) fullQuery = fullQuery.eq("user_id", userId);
  if (pondId !== undefined) {
    fullQuery = pondId
      ? fullQuery.eq("pond_id", pondId)
      : fullQuery.is("pond_id", null);
  }
  const full = await fullQuery;

  if (full.error) {
    let minimalQuery = supabase
      .from("ask_prana_messages")
      .select(MESSAGE_SELECT_MINIMAL)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (userId) minimalQuery = minimalQuery.eq("user_id", userId);
    if (pondId !== undefined) {
      minimalQuery = pondId
        ? minimalQuery.eq("pond_id", pondId)
        : minimalQuery.is("pond_id", null);
    }
    const minimal = await minimalQuery;

    if (minimal.error) {
      return { messages: [], error: new Error(minimal.error.message) };
    }

    return {
      messages: await Promise.all(
        (minimal.data as AskPranaMessageRow[]).map((row) =>
          mapRowToChatMessage(row),
        ),
      ),
      error: null,
    };
  }

  return {
    messages: await Promise.all(
      (full.data as AskPranaMessageRow[]).map((row) => mapRowToChatMessage(row)),
    ),
    error: null,
  };
}

const POND_HISTORY_SESSION_LIMIT = 50;
const POND_HISTORY_MESSAGE_LIMIT = 150;

/**
 * Load Ask Prana chat history for one authenticated user + pond scope.
 * Scoped via ask_prana_sessions.pond_id (then messages for those sessions).
 * Unscoped legacy messages (no pond session) are never returned.
 */
export async function fetchAskPranaMessagesForPond(
  userId: string,
  pondId: string | null,
): Promise<{ messages: ChatMessage[]; error: Error | null }> {
  if (!isValidAskPranaUuid(userId)) {
    return { messages: [], error: new Error("Invalid user_id.") };
  }
  if (pondId != null && !isValidAskPranaUuid(pondId)) {
    return { messages: [], error: new Error("Invalid pond_id.") };
  }

  let sessionQuery = supabase
    .from("ask_prana_sessions")
    .select("id")
    .eq("user_id", userId)
    .order("last_activity", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(POND_HISTORY_SESSION_LIMIT);

  sessionQuery = pondId
    ? sessionQuery.eq("pond_id", pondId)
    : sessionQuery.is("pond_id", null);

  let sessionsResult = await sessionQuery;

  if (sessionsResult.error) {
    let fallbackQuery = supabase
      .from("ask_prana_sessions")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(POND_HISTORY_SESSION_LIMIT);

    fallbackQuery = pondId
      ? fallbackQuery.eq("pond_id", pondId)
      : fallbackQuery.is("pond_id", null);

    sessionsResult = await fallbackQuery;
    if (sessionsResult.error) {
      return { messages: [], error: new Error(sessionsResult.error.message) };
    }
  }

  const sessionIds = (sessionsResult.data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => isValidAskPranaUuid(id));

  if (sessionIds.length === 0) {
    // Direct message.pond_id path when sessions are missing but messages are tagged.
    return fetchAskPranaMessagesByPondIdColumn(userId, pondId);
  }

  const full = await supabase
    .from("ask_prana_messages")
    .select(MESSAGE_SELECT)
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false })
    .limit(POND_HISTORY_MESSAGE_LIMIT);

  if (full.error) {
    const minimal = await supabase
      .from("ask_prana_messages")
      .select(MESSAGE_SELECT_MINIMAL)
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false })
      .limit(POND_HISTORY_MESSAGE_LIMIT);

    if (minimal.error) {
      return { messages: [], error: new Error(minimal.error.message) };
    }

    const minimalRows = [...(minimal.data as AskPranaMessageRow[])].reverse();
    return {
      messages: await Promise.all(
        minimalRows.map((row) => mapRowToChatMessage(row)),
      ),
      error: null,
    };
  }

  const rows = [...(full.data as AskPranaMessageRow[])]
    .reverse()
    .filter((row) => {
      // Never surface a message tagged for a different pond.
      if (pondId) {
        return row.pond_id == null || row.pond_id === pondId;
      }
      return row.pond_id == null;
    });

  return {
    messages: await Promise.all(rows.map((row) => mapRowToChatMessage(row))),
    error: null,
  };
}

async function fetchAskPranaMessagesByPondIdColumn(
  userId: string,
  pondId: string | null,
): Promise<{ messages: ChatMessage[]; error: Error | null }> {
  let query = supabase
    .from("ask_prana_messages")
    .select(MESSAGE_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(POND_HISTORY_MESSAGE_LIMIT);

  query = pondId ? query.eq("pond_id", pondId) : query.is("pond_id", null);

  const full = await query;
  if (full.error) {
    // Column/user_id may be missing on older schemas — treat as empty, not fatal.
    console.log(
      "[AskPrana] pond message fallback skipped:",
      full.error.message,
    );
    return { messages: [], error: null };
  }

  const rows = [...(full.data as AskPranaMessageRow[])].reverse();

  return {
    messages: await Promise.all(rows.map((row) => mapRowToChatMessage(row))),
    error: null,
  };
}

/** Session pond association for openConversation isolation checks. */
export async function getAskPranaSessionPondId(
  sessionId: string,
  userId?: string,
): Promise<{ pondId: string | null; userId: string | null; error: Error | null }> {
  if (!isValidAskPranaUuid(sessionId)) {
    return {
      pondId: null,
      userId: null,
      error: new Error("Invalid session_id."),
    };
  }

  let query = supabase
    .from("ask_prana_sessions")
    .select("pond_id, user_id")
    .eq("id", sessionId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();

  if (error) {
    return { pondId: null, userId: null, error: new Error(error.message) };
  }
  if (!data) {
    return { pondId: null, userId: null, error: new Error("Conversation not found.") };
  }

  return {
    pondId: data?.pond_id ?? null,
    userId: data?.user_id ?? null,
    error: null,
  };
}

export async function saveAskPranaMessage(
  input: SaveAskPranaMessageInput,
  originalMessage?: ChatMessage,
): Promise<{ message: ChatMessage | null; error: Error | null }> {
  const content = input.content ?? "";
  const mode =
    input.mode ?? (isValidAskPranaUuid(input.pondId) ? "pond" : "generic");
  const farmerName = input.farmerName?.trim() || null;
  const pondName =
    input.pondName?.trim() ||
    (mode === "generic" ? "Generic" : null);

  const attachments =
    input.filePath || input.fileName || input.mimeType
      ? [
          {
            path: input.filePath ?? null,
            name: input.fileName ?? null,
            mimeType: input.mimeType ?? null,
            messageType: input.messageType,
          },
        ]
      : null;

  const metadata = {
    ...(input.metadata ?? {}),
    messageType: input.messageType,
    syncedAt: new Date().toISOString(),
  };

  const fullInsert = await supabase
    .from("ask_prana_messages")
    .insert({
      session_id: input.sessionId,
      user_id: input.userId,
      pond_id: input.pondId ?? null,
      farmer_name: farmerName,
      pond_name: pondName,
      mode,
      role: input.role,
      message_type: input.messageType,
      content,
      file_path: input.filePath ?? null,
      file_name: input.fileName ?? null,
      mime_type: input.mimeType ?? null,
      metadata,
      attachments,
    })
    .select(MESSAGE_SELECT)
    .single();

  let row = fullInsert.data as AskPranaMessageRow | null;
  let insertError = fullInsert.error;

  if (insertError) {
    // Fallback when new enrichment columns are not migrated yet.
    const legacyInsert = await supabase
      .from("ask_prana_messages")
      .insert({
        session_id: input.sessionId,
        user_id: input.userId,
        pond_id: input.pondId ?? null,
        role: input.role,
        message_type: input.messageType,
        content,
        file_path: input.filePath ?? null,
        file_name: input.fileName ?? null,
        mime_type: input.mimeType ?? null,
      })
      .select(
        "id, session_id, user_id, pond_id, role, message_type, content, file_path, file_name, mime_type, created_at",
      )
      .single();

    if (legacyInsert.error) {
      const minimalInsert = await supabase
        .from("ask_prana_messages")
        .insert({
          session_id: input.sessionId,
          role: input.role,
          content,
        })
        .select(MESSAGE_SELECT_MINIMAL)
        .single();

      if (minimalInsert.error) {
        console.error(
          "[AskPrana] message insert failed:",
          minimalInsert.error.message,
        );
        return { message: null, error: new Error(minimalInsert.error.message) };
      }

      row = minimalInsert.data as AskPranaMessageRow;
    } else {
      row = legacyInsert.data as AskPranaMessageRow;
    }
    insertError = null;
  }

  // Touch session activity, last_message, and set title from first user message.
  const activityAt = new Date().toISOString();
  const previewText = previewFromContent(content);

  if (input.role === "user") {
    const { data: session } = await supabase
      .from("ask_prana_sessions")
      .select("title")
      .eq("id", input.sessionId)
      .maybeSingle();

    const updates: Record<string, string | null> = {
      last_activity: activityAt,
      last_message: previewText || content.slice(0, 80),
      mode,
      farmer_name: farmerName,
      pond_name: pondName,
    };

    if (!session?.title?.trim()) {
      updates.title = titleFromMessage(content);
    }

    const { error: updateError } = await supabase
      .from("ask_prana_sessions")
      .update(updates)
      .eq("id", input.sessionId);

    // Fallback if enrichment / last_message columns are not migrated yet.
    if (updateError) {
      const { last_message: _ignored, mode: _m, farmer_name: _f, pond_name: _p, ...rest } =
        updates;
      await supabase
        .from("ask_prana_sessions")
        .update(rest)
        .eq("id", input.sessionId);
    }
  } else {
    const updates: Record<string, string | null> = {
      last_activity: activityAt,
      last_message: previewText || content.slice(0, 80),
      mode,
      farmer_name: farmerName,
      pond_name: pondName,
    };

    const { error: updateError } = await supabase
      .from("ask_prana_sessions")
      .update(updates)
      .eq("id", input.sessionId);

    if (updateError) {
      await supabase
        .from("ask_prana_sessions")
        .update({ last_activity: activityAt })
        .eq("id", input.sessionId);
    }
  }

  if (!row) {
    return { message: null, error: new Error("Unable to save message.") };
  }

  return {
    message: originalMessage
      ? await mergePersistedMessage(originalMessage, row)
      : await mapRowToChatMessage(row),
    error: null,
  };
}

async function mergePersistedMessage(
  original: ChatMessage,
  row: AskPranaMessageRow,
): Promise<ChatMessage> {
  const saved = await mapRowToChatMessage(row);

  return {
    ...saved,
    localUri: original.localUri ?? saved.localUri,
    messageType: saved.messageType ?? original.messageType,
    fileUrl: saved.fileUrl ?? original.fileUrl,
    filePath: saved.filePath ?? original.filePath,
    fileName: saved.fileName ?? original.fileName,
    mimeType: saved.mimeType ?? original.mimeType,
    transcript: saved.transcript ?? original.transcript,
  };
}

const HISTORY_PAGE_SIZE = 100;

type SessionListRow = {
  id: string;
  pond_id: string | null;
  title?: string | null;
  created_at: string;
  last_activity?: string | null;
  last_message?: string | null;
};

type MessageTurn = {
  userId: string;
  userContent: string;
  userAt: string;
  assistantIds: string[];
  assistantContent: string | null;
  assistantAt: string | null;
};

/**
 * Older builds packed many Q&As into one session. Split those so History
 * shows one card per user question (user + following assistant reply).
 */
export async function splitPackedAskPranaSessions(
  userId: string,
  pondId: string | null,
): Promise<void> {
  if (!isValidAskPranaUuid(userId)) {
    return;
  }

  let sessionQuery = supabase
    .from("ask_prana_sessions")
    .select("id, language")
    .eq("user_id", userId);

  sessionQuery = pondId
    ? sessionQuery.eq("pond_id", pondId)
    : sessionQuery.is("pond_id", null);

  const { data: sessions, error } = await sessionQuery;
  if (error || !sessions?.length) {
    return;
  }

  for (const session of sessions) {
    const { data: messages, error: messagesError } = await supabase
      .from("ask_prana_messages")
      .select("id, role, content, created_at")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true });

    if (messagesError || !messages?.length) {
      continue;
    }

    const turns: MessageTurn[] = [];
    let current: MessageTurn | null = null;

    for (const message of messages) {
      if (message.role === "user") {
        if (current) {
          turns.push(current);
        }
        current = {
          userId: message.id,
          userContent: message.content ?? "",
          userAt: message.created_at,
          assistantIds: [],
          assistantContent: null,
          assistantAt: null,
        };
        continue;
      }

      if (message.role === "assistant" && current) {
        current.assistantIds.push(message.id);
        // Keep the latest assistant text in this turn as preview.
        current.assistantContent = message.content ?? current.assistantContent;
        current.assistantAt = message.created_at;
      }
    }

    if (current) {
      turns.push(current);
    }

    if (turns.length <= 1) {
      continue;
    }

    // Keep the first turn on the original session.
    const first = turns[0];
    const firstUpdates: Record<string, string> = {
      title: titleFromMessage(first.userContent),
      last_activity: first.assistantAt || first.userAt,
      last_message: previewFromContent(
        first.assistantContent || first.userContent,
      ),
    };

    const { error: firstUpdateError } = await supabase
      .from("ask_prana_sessions")
      .update(firstUpdates)
      .eq("id", session.id);

    if (firstUpdateError) {
      await supabase
        .from("ask_prana_sessions")
        .update({
          title: firstUpdates.title,
          last_activity: firstUpdates.last_activity,
        })
        .eq("id", session.id);
    }

    for (const turn of turns.slice(1)) {
      const created = await createAskPranaSession(userId, pondId, {
        title: titleFromMessage(turn.userContent),
        language: session.language ?? "English",
      });

      if (!created.sessionId) {
        console.log("[AskPrana] split session create failed:", created.error);
        continue;
      }

      const moveIds = [turn.userId, ...turn.assistantIds];
      const { error: moveError } = await supabase
        .from("ask_prana_messages")
        .update({ session_id: created.sessionId })
        .in("id", moveIds);

      if (moveError) {
        console.log("[AskPrana] split move messages failed:", moveError.message);
        continue;
      }

      const activity = turn.assistantAt || turn.userAt;
      const preview = previewFromContent(
        turn.assistantContent || turn.userContent,
      );
      const { error: metaError } = await supabase
        .from("ask_prana_sessions")
        .update({
          title: titleFromMessage(turn.userContent),
          last_activity: activity,
          last_message: preview,
        })
        .eq("id", created.sessionId);

      if (metaError) {
        await supabase
          .from("ask_prana_sessions")
          .update({
            title: titleFromMessage(turn.userContent),
            last_activity: activity,
          })
          .eq("id", created.sessionId);
      }
    }
  }
}

/** Fetch every conversation for a pond (paginated under the hood, no UI cap). */
export async function listAskPranaSessionsForPond(
  userId: string,
  pondId: string | null,
): Promise<{ sessions: AskPranaSessionSummary[]; error: Error | null }> {
  const rows: SessionListRow[] = [];
  let offset = 0;
  let useMinimal = false;

  while (true) {
    const from = offset;
    const to = offset + HISTORY_PAGE_SIZE - 1;

    let page;
    if (!useMinimal) {
      let query = supabase
        .from("ask_prana_sessions")
        .select("id, pond_id, title, created_at, last_activity, last_message")
        .eq("user_id", userId)
        .order("last_activity", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);

      query = pondId ? query.eq("pond_id", pondId) : query.is("pond_id", null);
      page = await query;

      if (page.error) {
        useMinimal = true;
        continue;
      }
    } else {
      let query = supabase
        .from("ask_prana_sessions")
        .select("id, pond_id, title, created_at, last_activity")
        .eq("user_id", userId)
        .order("last_activity", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);

      query = pondId ? query.eq("pond_id", pondId) : query.is("pond_id", null);
      page = await query;

      if (page.error) {
        // Final fallback: created_at only (pre-migration schemas).
        let fallbackQuery = supabase
          .from("ask_prana_sessions")
          .select("id, pond_id, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .range(from, to);

        fallbackQuery = pondId
          ? fallbackQuery.eq("pond_id", pondId)
          : fallbackQuery.is("pond_id", null);

        const fallback = await fallbackQuery;
        if (fallback.error) {
          return { sessions: [], error: new Error(fallback.error.message) };
        }
        page = fallback;
      }
    }

    const batch = (page.data ?? []) as SessionListRow[];
    rows.push(...batch);

    if (batch.length < HISTORY_PAGE_SIZE) {
      break;
    }

    offset += HISTORY_PAGE_SIZE;
  }

  const sessions = (
    await Promise.all(
      rows.map(async (row) => {
        const storedPreview = previewFromContent(row.last_message);
        let title = row.title?.trim() || "";
        let preview = storedPreview;
        let lastActivity = row.last_activity || row.created_at;

        // Only hit messages table when session summary fields are incomplete.
        if (!title || !preview) {
          const messagePreview = await fetchLatestMessagePreview(row.id);
          if (!messagePreview.hasMessages) {
            return null;
          }
          title = title || messagePreview.title || "New conversation";
          preview = preview || messagePreview.preview;
          lastActivity = messagePreview.lastActivity || lastActivity;
        }

        return {
          id: row.id,
          pondId: row.pond_id,
          title: title || "New conversation",
          preview,
          createdAt: row.created_at,
          lastActivity,
        } satisfies AskPranaSessionSummary;
      }),
    )
  ).filter((session): session is AskPranaSessionSummary => session != null);

  // Newest activity first (stable if DB ordering already applied).
  sessions.sort((a, b) => {
    const aTime = new Date(a.lastActivity || a.createdAt).getTime();
    const bTime = new Date(b.lastActivity || b.createdAt).getTime();
    return bTime - aTime;
  });

  return { sessions, error: null };
}

async function fetchLatestMessagePreview(sessionId: string) {
  const { data } = await supabase
    .from("ask_prana_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const firstUser = await supabase
    .from("ask_prana_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    hasMessages: Boolean(data),
    title: titleFromMessage(firstUser.data?.content),
    preview: previewFromContent(data?.content),
    lastActivity: data?.created_at ?? null,
  };
}

export async function renameAskPranaSession(
  sessionId: string,
  title: string,
): Promise<{ error: Error | null }> {
  const trimmed = title.trim();
  if (!trimmed) {
    return { error: new Error("Title cannot be empty.") };
  }

  const { error } = await supabase
    .from("ask_prana_sessions")
    .update({ title: trimmed })
    .eq("id", sessionId);

  if (error) {
    return { error: new Error(error.message) };
  }

  return { error: null };
}

export async function deleteAskPranaSession(
  sessionId: string,
): Promise<{ error: Error | null }> {
  const { data: attachments, error: attachmentsError } = await supabase
    .from("ask_prana_messages")
    .select("file_path")
    .eq("session_id", sessionId);

  if (attachmentsError) {
    return { error: new Error(attachmentsError.message) };
  }

  const filePaths = [...new Set((attachments ?? []).map((row) => row.file_path).filter(Boolean))];
  if (filePaths.length > 0) {
    await Promise.all(
      ["ask-prana-files", "aquagpt-files"].map((bucket) =>
        supabase.storage.from(bucket).remove(filePaths),
      ),
    );
  }

  const { error: messagesError } = await supabase
    .from("ask_prana_messages")
    .delete()
    .eq("session_id", sessionId);

  if (messagesError) {
    console.log("[AskPrana] delete messages:", messagesError.message);
  }

  const { error } = await supabase
    .from("ask_prana_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    return { error: new Error(error.message) };
  }

  return { error: null };
}
