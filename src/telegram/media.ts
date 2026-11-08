/**
 * Telegram photo & media downloader module.
 *
 * Downloads photos/media from Telegram Bot API and converts them into
 * base64-encoded ImageContentPart structures for Pi AI-agent multimodal RPC.
 */

export interface PhotoSizeLike {
  file_id: string;
  file_unique_id?: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramFileLike {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export interface BotApiLike {
  getFile?(fileId: string): Promise<TelegramFileLike>;
  api?: {
    getFile(fileId: string): Promise<TelegramFileLike>;
  };
}

export interface DownloadedPhoto {
  data: string;
  mimeType: string;
}

/**
 * Given Telegram's array of PhotoSize objects, selects the highest resolution / largest photo.
 *
 * Compares by area (width * height), with file_size as tie-breaker.
 * Returns null if the photos array is empty or invalid.
 */
export function getLargestPhotoFileId(
  photos: PhotoSizeLike[] | null | undefined
): string | null {
  if (!photos || photos.length === 0) {
    return null;
  }

  let best = photos[0];
  let bestArea = best.width * best.height;
  let bestSize = best.file_size ?? 0;

  for (let i = 1; i < photos.length; i++) {
    const candidate = photos[i];
    const candidateArea = candidate.width * candidate.height;
    const candidateSize = candidate.file_size ?? 0;

    if (
      candidateArea > bestArea ||
      (candidateArea === bestArea && candidateSize > bestSize)
    ) {
      best = candidate;
      bestArea = candidateArea;
      bestSize = candidateSize;
    }
  }

  return best.file_id;
}

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Determines MIME type from file extension. Defaults to "image/jpeg".
 */
export function getMimeTypeFromPath(filePath: string): string {
  if (!filePath) {
    return "image/jpeg";
  }

  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filePath.length - 1) {
    return "image/jpeg";
  }

  const ext = filePath.slice(dotIndex + 1).toLowerCase();
  return MIME_MAP[ext] ?? "image/jpeg";
}

/**
 * Sanitizes any sensitive Telegram bot tokens from error messages and stacks.
 */
export function sanitizeToken(error: unknown, token: string): Error {
  if (!token) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const rawMsg = error instanceof Error ? error.message : String(error);
  const sanitizedMsg = rawMsg.replaceAll(token, "[REDACTED_BOT_TOKEN]");
  const err = new Error(sanitizedMsg);
  if (error instanceof Error && error.stack) {
    err.stack = error.stack.replaceAll(token, "[REDACTED_BOT_TOKEN]");
  }
  return err;
}

/**
 * Downloads a photo from Telegram by its fileId and converts it into a base64 string
 * with inferred MIME type.
 *
 * @param bot Bot or Bot.api instance supporting getFile
 * @param fileId Telegram file_id
 * @param botToken Telegram Bot API token
 * @param fetchFn Optional custom fetch function for testing or proxying
 * @returns Object with base64 data and mimeType
 */
export async function downloadTelegramPhotoAsBase64(
  bot: BotApiLike,
  fileId: string,
  botToken: string,
  fetchFn: typeof fetch = fetch
): Promise<DownloadedPhoto> {
  const getFileFn =
    typeof bot?.getFile === "function"
      ? bot.getFile.bind(bot)
      : bot?.api && typeof bot.api.getFile === "function"
        ? bot.api.getFile.bind(bot.api)
        : null;

  if (!getFileFn) {
    throw new Error(
      "Invalid bot instance: getFile method not found on bot or bot.api"
    );
  }

  const fileInfo = await getFileFn(fileId);
  if (!fileInfo || !fileInfo.file_path) {
    throw new Error(
      `Telegram API did not return a valid file_path for fileId: ${fileId}`
    );
  }

  if (fileInfo.file_size !== undefined && fileInfo.file_size > MAX_FILE_BYTES) {
    throw new Error(
      `File size (${fileInfo.file_size} bytes) exceeds maximum limit of ${MAX_FILE_BYTES} bytes`
    );
  }

  const url = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

  try {
    const response = await fetchFn(url);

    if (!response.ok) {
      throw new Error(
        `Failed to download file from Telegram: HTTP ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FILE_BYTES) {
      throw new Error(
        `File payload size (${arrayBuffer.byteLength} bytes) exceeds maximum limit of ${MAX_FILE_BYTES} bytes`
      );
    }
    const data = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = getMimeTypeFromPath(fileInfo.file_path);

    return {
      data,
      mimeType,
    };
  } catch (err) {
    throw sanitizeToken(err, botToken);
  }
}

/**
 * Alias for downloadTelegramPhotoAsBase64.
 */
export const downloadPhotoAsBase64 = downloadTelegramPhotoAsBase64;
