import { describe, it, expect, vi } from "vitest";
import {
  getLargestPhotoFileId,
  getMimeTypeFromPath,
  downloadTelegramPhotoAsBase64,
  downloadPhotoAsBase64,
  type BotApiLike,
  type PhotoSizeLike,
} from "../src/telegram/media.js";

describe("getLargestPhotoFileId", () => {
  it("returns null for empty photo array", () => {
    expect(getLargestPhotoFileId([])).toBeNull();
  });

  it("returns null for null or undefined photo array", () => {
    expect(getLargestPhotoFileId(null)).toBeNull();
    expect(getLargestPhotoFileId(undefined)).toBeNull();
  });

  it("returns file_id of single photo", () => {
    const photos: PhotoSizeLike[] = [
      { file_id: "photo_1", width: 320, height: 240, file_size: 1024 },
    ];
    expect(getLargestPhotoFileId(photos)).toBe("photo_1");
  });

  it("returns largest photo by dimensions when ordered ascending", () => {
    const photos: PhotoSizeLike[] = [
      { file_id: "small_id", width: 100, height: 100 },
      { file_id: "med_id", width: 400, height: 300 },
      { file_id: "large_id", width: 1280, height: 720 },
    ];
    expect(getLargestPhotoFileId(photos)).toBe("large_id");
  });

  it("returns largest photo when ordered descending or mixed", () => {
    const photos: PhotoSizeLike[] = [
      { file_id: "large_id", width: 1920, height: 1080 },
      { file_id: "small_id", width: 320, height: 240 },
      { file_id: "med_id", width: 800, height: 600 },
    ];
    expect(getLargestPhotoFileId(photos)).toBe("large_id");
  });

  it("breaks ties with file_size if dimensions are equal", () => {
    const photos: PhotoSizeLike[] = [
      { file_id: "p1", width: 800, height: 600, file_size: 20000 },
      { file_id: "p2", width: 800, height: 600, file_size: 45000 },
    ];
    expect(getLargestPhotoFileId(photos)).toBe("p2");

    // Reverse order: first photo already has larger file_size
    const reversed: PhotoSizeLike[] = [
      { file_id: "p2", width: 800, height: 600, file_size: 45000 },
      { file_id: "p1", width: 800, height: 600, file_size: 20000 },
    ];
    expect(getLargestPhotoFileId(reversed)).toBe("p2");
  });
});

describe("getMimeTypeFromPath", () => {
  it("detects jpeg/jpg extensions case-insensitively", () => {
    expect(getMimeTypeFromPath("photo.jpg")).toBe("image/jpeg");
    expect(getMimeTypeFromPath("photo.jpeg")).toBe("image/jpeg");
    expect(getMimeTypeFromPath("dir/photo.JPG")).toBe("image/jpeg");
    expect(getMimeTypeFromPath("dir/nested/photo.JPEG")).toBe("image/jpeg");
  });

  it("detects png extension case-insensitively", () => {
    expect(getMimeTypeFromPath("image.png")).toBe("image/png");
    expect(getMimeTypeFromPath("image.PNG")).toBe("image/png");
  });

  it("detects webp extension case-insensitively", () => {
    expect(getMimeTypeFromPath("sticker.webp")).toBe("image/webp");
    expect(getMimeTypeFromPath("sticker.WEBP")).toBe("image/webp");
  });

  it("detects gif extension case-insensitively", () => {
    expect(getMimeTypeFromPath("anim.gif")).toBe("image/gif");
    expect(getMimeTypeFromPath("anim.GIF")).toBe("image/gif");
  });

  it("defaults to image/jpeg for unknown or missing extensions", () => {
    expect(getMimeTypeFromPath("file_without_ext")).toBe("image/jpeg");
    expect(getMimeTypeFromPath("file_with_trailing_dot.")).toBe("image/jpeg");
    expect(getMimeTypeFromPath("file.xyz")).toBe("image/jpeg");
    expect(getMimeTypeFromPath("")).toBe("image/jpeg");
  });
});

describe("downloadTelegramPhotoAsBase64", () => {
  const fakeToken = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
  const binaryContent = Buffer.from("fake-binary-image-data-content");
  const expectedBase64 = binaryContent.toString("base64");

  it("downloads photo and converts to base64 with correct mimeType", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "photo_abc",
        file_path: "photos/file_99.jpg",
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => binaryContent.buffer.slice(
        binaryContent.byteOffset,
        binaryContent.byteOffset + binaryContent.byteLength
      ),
    } as unknown as Response);

    const result = await downloadTelegramPhotoAsBase64(
      mockBot,
      "photo_abc",
      fakeToken,
      mockFetch as unknown as typeof fetch
    );

    expect(mockBot.getFile).toHaveBeenCalledWith("photo_abc");
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/file/bot${fakeToken}/photos/file_99.jpg`
    );
    expect(result).toEqual({
      data: expectedBase64,
      mimeType: "image/jpeg",
    });
  });

  it("uses global fetch when fetchFn is not passed", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "photo_default",
        file_path: "photos/default.jpg",
      }),
    };

    const globalFetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => binaryContent.buffer.slice(
        binaryContent.byteOffset,
        binaryContent.byteOffset + binaryContent.byteLength
      ),
    } as unknown as Response);

    vi.stubGlobal("fetch", globalFetchSpy);

    try {
      const result = await downloadTelegramPhotoAsBase64(
        mockBot,
        "photo_default",
        fakeToken
      );

      expect(globalFetchSpy).toHaveBeenCalledWith(
        `https://api.telegram.org/file/bot${fakeToken}/photos/default.jpg`
      );
      expect(result.data).toBe(expectedBase64);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("correctly identifies png and webp mime types", async () => {
    const mockBotPng: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "png_id",
        file_path: "documents/graphic.PNG",
      }),
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => binaryContent.buffer.slice(
        binaryContent.byteOffset,
        binaryContent.byteOffset + binaryContent.byteLength
      ),
    } as unknown as Response);

    const pngResult = await downloadTelegramPhotoAsBase64(
      mockBotPng,
      "png_id",
      fakeToken,
      mockFetch as unknown as typeof fetch
    );
    expect(pngResult.mimeType).toBe("image/png");

    const mockBotWebp: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "webp_id",
        file_path: "stickers/sticker.webp",
      }),
    };
    const webpResult = await downloadTelegramPhotoAsBase64(
      mockBotWebp,
      "webp_id",
      fakeToken,
      mockFetch as unknown as typeof fetch
    );
    expect(webpResult.mimeType).toBe("image/webp");
  });

  it("supports bot object where getFile is under .api", async () => {
    const mockBotWithApi = {
      api: {
        getFile: vi.fn().mockResolvedValue({
          file_id: "photo_api_id",
          file_path: "photos/from_api.jpg",
        }),
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => binaryContent.buffer.slice(
        binaryContent.byteOffset,
        binaryContent.byteOffset + binaryContent.byteLength
      ),
    } as unknown as Response);

    const result = await downloadTelegramPhotoAsBase64(
      mockBotWithApi as unknown as BotApiLike,
      "photo_api_id",
      fakeToken,
      mockFetch as unknown as typeof fetch
    );

    expect(mockBotWithApi.api.getFile).toHaveBeenCalledWith("photo_api_id");
    expect(result.data).toBe(expectedBase64);
  });

  it("downloadPhotoAsBase64 works as alias of downloadTelegramPhotoAsBase64", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "alias_id",
        file_path: "photos/alias.jpg",
      }),
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => binaryContent.buffer.slice(
        binaryContent.byteOffset,
        binaryContent.byteOffset + binaryContent.byteLength
      ),
    } as unknown as Response);

    const result = await downloadPhotoAsBase64(
      mockBot,
      "alias_id",
      fakeToken,
      mockFetch as unknown as typeof fetch
    );
    expect(result.data).toBe(expectedBase64);
  });

  it("throws error when file_size exceeds MAX_FILE_BYTES", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "oversized_id",
        file_path: "photos/huge.jpg",
        file_size: 25 * 1024 * 1024,
      }),
    };
    const mockFetch = vi.fn();

    await expect(
      downloadTelegramPhotoAsBase64(
        mockBot,
        "oversized_id",
        fakeToken,
        mockFetch as unknown as typeof fetch
      )
    ).rejects.toThrow(/exceeds maximum limit/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws error when downloaded payload exceeds MAX_FILE_BYTES even if file_size was omitted", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "omitted_size_id",
        file_path: "photos/large_download.jpg",
        // file_size is undefined
      }),
    };
    const hugeBuffer = new Uint8Array(21 * 1024 * 1024);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => hugeBuffer.buffer,
    } as unknown as Response);

    await expect(
      downloadTelegramPhotoAsBase64(
        mockBot,
        "omitted_size_id",
        fakeToken,
        mockFetch as unknown as typeof fetch
      )
    ).rejects.toThrow(/payload size.*exceeds maximum limit/i);
  });

  it("sanitizes botToken from error messages if fetch fails with URL in message", async () => {
    const secretToken = "SECRET_BOT_TOKEN_123456";
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "sec_id",
        file_path: "photos/sec.jpg",
      }),
    };
    const mockFetch = vi.fn().mockRejectedValue(
      new Error(`Network request to https://api.telegram.org/file/bot${secretToken}/photos/sec.jpg failed`)
    );

    await expect(
      downloadTelegramPhotoAsBase64(
        mockBot,
        "sec_id",
        secretToken,
        mockFetch as unknown as typeof fetch
      )
    ).rejects.toThrow(/REDACTED_BOT_TOKEN/);

    try {
      await downloadTelegramPhotoAsBase64(
        mockBot,
        "sec_id",
        secretToken,
        mockFetch as unknown as typeof fetch
      );
    } catch (err) {
      expect((err as Error).message).not.toContain(secretToken);
      expect((err as Error).message).toContain("[REDACTED_BOT_TOKEN]");
    }
  });

  it("throws error when getFile response lacks file_path", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "no_path_id",
        file_path: undefined,
      }),
    };

    await expect(
      downloadTelegramPhotoAsBase64(mockBot, "no_path_id", fakeToken)
    ).rejects.toThrow("file_path");

    // Also test null fileInfo
    const mockBotNull: BotApiLike = {
      getFile: vi.fn().mockResolvedValue(null),
    };
    await expect(
      downloadTelegramPhotoAsBase64(mockBotNull, "null_id", fakeToken)
    ).rejects.toThrow("file_path");
  });

  it("throws error when getFile method is missing on bot", async () => {
    await expect(downloadTelegramPhotoAsBase64({}, "id", fakeToken)).rejects.toThrow(
      "getFile"
    );
  });

  it("throws error when HTTP download fails with non-200 status", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "err_id",
        file_path: "photos/missing.jpg",
      }),
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as unknown as Response);

    await expect(
      downloadTelegramPhotoAsBase64(
        mockBot,
        "err_id",
        fakeToken,
        mockFetch as unknown as typeof fetch
      )
    ).rejects.toThrow("404");
  });

  it("propagates network errors from fetch", async () => {
    const mockBot: BotApiLike = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "err_id",
        file_path: "photos/file.jpg",
      }),
    };
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection reset by peer"));

    await expect(
      downloadTelegramPhotoAsBase64(
        mockBot,
        "err_id",
        fakeToken,
        mockFetch as unknown as typeof fetch
      )
    ).rejects.toThrow("Connection reset by peer");
  });
});


