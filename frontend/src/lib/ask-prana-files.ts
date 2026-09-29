import { supabase } from "./supabase";

/** Live storage bucket (rename to ask-prana-files deferred until storage migration). */
export const ASK_PRANA_FILES_BUCKET = "aquagpt-files";

const FILE_BUCKETS = ["aquagpt-files", "ask-prana-files"] as const;

export type AskPranaFileFolder = "audio" | "images" | "documents";

export type UploadedAskPranaFile = {
  filePath: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize?: number | null;
  localUri?: string | null;
};

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extensionFromName(value?: string | null) {
  const name = (value ?? "").split("?")[0].toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) {
    return "";
  }
  return name.slice(dot + 1);
}

function mimeFromExtension(extension: string) {
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "m4a":
      return "audio/m4a";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    default:
      return null;
  }
}

function resolveMimeType(
  uri: string,
  fileName?: string | null,
  mimeType?: string | null,
  blobType?: string | null,
) {
  const fromName = mimeFromExtension(extensionFromName(fileName));
  if (fromName) {
    return fromName;
  }

  const fromUri = mimeFromExtension(extensionFromName(uri));
  if (fromUri) {
    return fromUri;
  }

  if (mimeType && mimeType !== "application/octet-stream") {
    return mimeType;
  }

  if (blobType && blobType !== "application/octet-stream") {
    return blobType;
  }

  return mimeType ?? blobType ?? "application/octet-stream";
}

function guessExtension(
  uri: string,
  mimeType?: string | null,
  fileName?: string | null,
) {
  const named = extensionFromName(fileName);
  if (named && named.length <= 5) {
    return named;
  }

  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  if (mimeType?.includes("gif")) return "gif";
  if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) return "jpg";
  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("mpeg") || mimeType?.includes("mp3")) return "mp3";
  if (mimeType?.includes("wav")) return "wav";
  if (mimeType?.includes("m4a") || mimeType?.includes("mp4")) return "m4a";
  if (mimeType?.includes("csv")) return "csv";
  if (mimeType?.includes("plain")) return "txt";
  if (mimeType?.includes("spreadsheet") || mimeType?.includes("excel")) {
    return "xlsx";
  }
  if (mimeType?.includes("word")) return "docx";

  const fromUri = extensionFromName(uri);
  if (fromUri && fromUri.length <= 5) {
    return fromUri;
  }

  return "bin";
}

export async function uploadAskPranaFile({
  uri,
  folder,
  fileName,
  mimeType,
  userId,
}: {
  uri: string;
  folder: AskPranaFileFolder;
  fileName?: string | null;
  mimeType?: string | null;
  userId?: string | null;
}): Promise<{ data: UploadedAskPranaFile | null; error: string | null }> {
  const extension = guessExtension(uri, mimeType, fileName);
  const safeName = sanitizeFileName(
    fileName?.trim() || `file-${Date.now()}.${extension}`,
  );
  const ownerPrefix = userId ? `${userId}/` : "";
  const filePath = `${folder}/${ownerPrefix}${Date.now()}-${safeName}`;

  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const resolvedMime = resolveMimeType(uri, safeName, mimeType, blob.type);

    let lastError: string | null = null;
    let uploaded = false;

    for (const bucket of FILE_BUCKETS) {
      const { error } = await supabase.storage.from(bucket).upload(filePath, blob, {
        contentType: resolvedMime,
        upsert: false,
      });
      if (!error) {
        uploaded = true;
        break;
      }
      lastError = error.message;
    }

    if (!uploaded) {
      return { data: null, error: lastError ?? "Unable to upload file right now." };
    }

    const fileUrl = await getAskPranaFileUrl(filePath);

    return {
      data: {
        filePath,
        fileUrl: fileUrl ?? uri,
        fileName: safeName,
        mimeType: resolvedMime,
        fileSize: blob.size ?? null,
        localUri: uri,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to upload file right now.",
    };
  }
}

export async function getAskPranaFileUrl(filePath: string | null) {
  if (!filePath) {
    return null;
  }

  for (const bucket of FILE_BUCKETS) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }

  for (const bucket of FILE_BUCKETS) {
    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);
    if (publicData.publicUrl) {
      return publicData.publicUrl;
    }
  }

  return null;
}
