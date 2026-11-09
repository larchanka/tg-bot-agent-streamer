import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamThrottler, type TelegramApiLike } from "../src/telegram/throttler.js";

function createMockApi() {
  let nextMessageId = 100;
  return {
    sendMessage: vi.fn().mockImplementation(async (chatId: number | string, text: string, options?: { parse_mode?: string }) => {
      return { message_id: ++nextMessageId, text, options };
    }),
    editMessageText: vi.fn().mockImplementation(async (chatId: number | string, messageId: number, text: string, options?: { parse_mode?: string }) => {
      return { message_id: messageId, text, options };
    }),
    sendChatAction: vi.fn().mockImplementation(async (chatId: number | string, action: string) => {
      return true;
    }),
  };
}

function createRichMockApi() {
  let nextMessageId = 200;
  return {
    ...createMockApi(),
    sendRichMessage: vi.fn().mockImplementation(async (chatId: number | string, richMessage: unknown, other?: unknown) => {
      return { message_id: ++nextMessageId, rich_message: richMessage, other };
    }),
    sendRichMessageDraft: vi.fn().mockImplementation(async (chatId: number | string, draftId: number, richMessage: unknown, other?: unknown) => {
      return { draft_id: draftId, rich_message: richMessage, other };
    }),
  };
}

describe("StreamThrottler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Slice 1: Buffering & Initialization", () => {
    it("accumulates tokens in buffer without immediate edit until throttle timer fires", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Hello ");
      throttler.feed("World!");

      expect(throttler.currentText).toBe("Hello World!");
      // Before throttle timer elapses, no edits should be dispatched
      expect(mockApi.editMessageText).not.toHaveBeenCalled();
      expect(mockApi.sendMessage).not.toHaveBeenCalled();

      // Advance timer by 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      // Now the first message should have been sent/edited
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining("Hello World"),
        { parse_mode: "MarkdownV2" }
      );
    });

    it("uses initialMessageId if provided and performs editMessageText instead of sendMessage", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        initialMessageId: 999,
      });

      throttler.feed("Streaming update");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendMessage).not.toHaveBeenCalled();
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        12345,
        999,
        expect.stringContaining("Streaming update"),
        { parse_mode: "MarkdownV2" }
      );
    });
  });

  describe("Slice 2: Throttled Edit Loop & Rate Limiting", () => {
    it("ensures at most one edit per throttle window even when feeding rapidly", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Token 1 ");
      await vi.advanceTimersByTimeAsync(1000); // 1st edit: sends initial message (id 101)
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(0);

      // Rapidly feed multiple tokens within next 1s window
      throttler.feed("Token 2 ");
      throttler.feed("Token 3 ");
      throttler.feed("Token 4 ");

      // At 500ms, no edit should have occurred yet
      await vi.advanceTimersByTimeAsync(500);
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(0);

      // At 1000ms, exactly one batched edit is dispatched
      await vi.advanceTimersByTimeAsync(500);
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        12345,
        101,
        expect.stringContaining("Token 1 Token 2 Token 3 Token 4"),
        { parse_mode: "MarkdownV2" }
      );

      // Advancing timer with no new tokens dispatched must not send another edit
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
    });
  });

  describe("Slice 3: Tool Status Indicator", () => {
    it("displays tool status badge during intermediate streaming and removes it when set to null", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Analyzing files...");
      throttler.setToolStatus("search_files");

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      const callArg = mockApi.sendMessage.mock.calls[0][1];
      // Check that the tool status indicator is present in the formatted output
      expect(callArg).toMatch(/search_files/);
      expect(callArg).toMatch(/Running/);

      // Now clear tool status
      throttler.setToolStatus(null);
      throttler.feed(" Done searching.");

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
      const editArg = mockApi.editMessageText.mock.calls[0][2];
      expect(editArg).not.toMatch(/search_files/);
      expect(editArg).not.toMatch(/Running/);
      expect(editArg).toMatch(/Done searching/);
    });

    it("displays tool status badge even if buffer is currently empty", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.setToolStatus("bash");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      const callArg = mockApi.sendMessage.mock.calls[0][1];
      expect(callArg).toMatch(/bash/);
      expect(callArg).toMatch(/Running/);
    });
  });

  describe("Slice 4: Markdown Parse Fallback & Error Resilience", () => {
    it("falls back to plain unformatted text if editMessageText fails with entity parse error", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        initialMessageId: 555,
      });

      // Mock editMessageText to reject on MarkdownV2 with parse error, but succeed without parse_mode
      mockApi.editMessageText.mockImplementation(async (_chatId, _msgId, text, options) => {
        if (options?.parse_mode === "MarkdownV2") {
          throw new Error("Bad Request: can't parse entities in message text: character '_' is reserved");
        }
        return { message_id: 555, text, options };
      });

      throttler.feed("Bad _ markdown ` example");
      await vi.advanceTimersByTimeAsync(1000);

      // Should have attempted with MarkdownV2 first, then retried without parse_mode
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockApi.editMessageText.mock.calls[0][3]).toEqual({ parse_mode: "MarkdownV2" });
      expect(mockApi.editMessageText.mock.calls[1][3]).toBeUndefined();
    });

    it("silently ignores 'message is not modified' errors without throwing", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        initialMessageId: 555,
      });

      mockApi.editMessageText.mockRejectedValue(
        new Error("Bad Request: message is not modified: specified new message content and reply markup are exactly the same")
      );

      throttler.feed("Same text");
      // Must not throw unhandled rejection
      await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("falls back to plain unformatted text if initial sendMessage fails with entity parse error", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      mockApi.sendMessage.mockImplementation(async (_chatId, text, options) => {
        if (options?.parse_mode === "MarkdownV2") {
          throw new Error("Bad Request: can't parse entities");
        }
        return { message_id: 888, text, options };
      });

      throttler.feed("Initial text with syntax");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockApi.sendMessage.mock.calls[0][2]).toEqual({ parse_mode: "MarkdownV2" });
      expect(mockApi.sendMessage.mock.calls[1][2]).toBeUndefined();
      expect(throttler.messageId).toBe(888);
    });

    it("rethrows non-parse errors from editMessageText", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        initialMessageId: 555,
      });

      mockApi.editMessageText.mockRejectedValue(new Error("502 Bad Gateway: Connection reset"));

      throttler.feed("Any text");
      // finalize rethrows
      await expect(throttler.finalize()).rejects.toThrow("502 Bad Gateway");
    });

    it("retains dirty flag and retries on subsequent tick if intermediate edit fails unexpectedly", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        initialMessageId: 555,
      });

      // Fail once with network error, then succeed
      mockApi.editMessageText
        .mockRejectedValueOnce(new Error("500 Internal Server Error"))
        .mockResolvedValueOnce({ message_id: 555 });

      throttler.feed("Retry this token");

      // Advance by 1000ms - first attempt fails, should not throw unhandled rejection
      await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);

      // Advance by another 1000ms - second attempt retries and succeeds
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockApi.editMessageText).toHaveBeenLastCalledWith(
        12345,
        555,
        expect.stringContaining("Retry this token"),
        { parse_mode: "MarkdownV2" }
      );
    });
  });

  describe("Slice 5: Message Splitting (>4000 characters)", () => {
    it("splits long responses across messages by finalizing the first message and opening a continuation", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        maxMessageLength: 100, // use small limit for test
      });

      // Feed 80 chars
      const part1 = "A".repeat(80);
      throttler.feed(part1);
      await vi.advanceTimersByTimeAsync(1000);

      // Initial message sent (id 101)
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(throttler.messageId).toBe(101);

      // Feed another 50 chars, bringing total to 130 > 100
      const part2 = "B".repeat(50);
      throttler.feed(part2);
      await vi.advanceTimersByTimeAsync(1000);

      // The first message (id 101) should be finalized with the first 100 chars (part1 + 20 chars of part2)
      // And a new continuation message (id 102) should be sent with the remaining 30 chars
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        12345,
        101,
        expect.stringContaining("A".repeat(80) + "B".repeat(20)),
        { parse_mode: "MarkdownV2" }
      );

      // Second message sent
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockApi.sendMessage).toHaveBeenLastCalledWith(
        12345,
        expect.stringContaining("B".repeat(30)),
        { parse_mode: "MarkdownV2" }
      );
      expect(throttler.messageId).toBe(102);
    });

    it("prefers splitting on newlines when close to maxMessageLength boundary", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        maxMessageLength: 100,
      });

      // Feed 85 chars, then newline, then 40 chars
      const line1 = "X".repeat(85);
      const line2 = "Y".repeat(40);
      throttler.feed(`${line1}\n${line2}`);

      await vi.advanceTimersByTimeAsync(1000);

      // First message finalized at the newline boundary (line1)
      // Continuation message receives line2
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockApi.sendMessage.mock.calls[0][1]).toContain(line1);
      expect(mockApi.sendMessage.mock.calls[1][1]).toContain(line2);
      expect(throttler.messageId).toBe(102);
    });

    it("handles multiple splits when a single large chunk exceeds multiple message lengths", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        maxMessageLength: 50,
      });

      // Feed 160 characters (exceeds 3 x 50)
      throttler.feed("M".repeat(160));
      await vi.advanceTimersByTimeAsync(1000);

      // 3 messages of 50 chars finalized + 1 active continuation message of 10 chars
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(4);
      expect(throttler.messageId).toBe(104);
    });

    it("preserves buffer without dropping chunks if splitting edit fails and retries on next tick", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        maxMessageLength: 50,
        initialMessageId: 100,
      });

      // Fail first edit with transient network error
      mockApi.editMessageText
        .mockRejectedValueOnce(new Error("503 Service Unavailable"))
        .mockResolvedValueOnce({ message_id: 100 });

      // Feed 70 chars (> 50 limit)
      throttler.feed("K".repeat(70));

      // 1st tick: edit fails, buffer must not lose the first 50 chars
      await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
      expect(throttler.currentText).toBe("K".repeat(70));

      // 2nd tick: retry succeeds and splits cleanly
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(throttler.currentText).toBe("K".repeat(20));
    });
  });

  describe("Slice 6: Finalization & Typing Indicator", () => {
    it("sends typing chat action initially and every typingIntervalMs until finalize", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        typingIntervalMs: 4000,
      });

      // Initial typing action fired on creation
      expect(mockApi.sendChatAction).toHaveBeenCalledTimes(1);
      expect(mockApi.sendChatAction).toHaveBeenCalledWith(12345, "typing");

      // Advance by 4000ms -> second typing action
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockApi.sendChatAction).toHaveBeenCalledTimes(2);

      // Advance by another 4000ms -> third typing action
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockApi.sendChatAction).toHaveBeenCalledTimes(3);

      // Finalize throttler
      await throttler.finalize();

      // Advancing timer further should NOT trigger any more typing actions
      await vi.advanceTimersByTimeAsync(8000);
      expect(mockApi.sendChatAction).toHaveBeenCalledTimes(3);
      expect(throttler.isFinalized).toBe(true);
    });

    it("does not start typing timer if typingIntervalMs is 0", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        typingIntervalMs: 0,
      });

      await vi.advanceTimersByTimeAsync(8000);
      expect(mockApi.sendChatAction).not.toHaveBeenCalled();
      await throttler.finalize();
    });

    it("flushes remaining buffer immediately on finalize without waiting for timer", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Immediate completion text");
      // Call finalize immediately without advancing timers
      await throttler.finalize();

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining("Immediate completion text"),
        { parse_mode: "MarkdownV2" }
      );
    });

    it("does not render tool status badge in the finalized message", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Final response content.");
      throttler.setToolStatus("readFile");

      await throttler.finalize();

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      const content = mockApi.sendMessage.mock.calls[0][1];
      expect(content).not.toMatch(/readFile/);
      expect(content).not.toMatch(/Running/);
      expect(content).toMatch(/Final response content/);
    });

    it("clears running tool badge to a clean status when finalizing with an empty buffer", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      // Only tool status was emitted, no text tokens
      throttler.setToolStatus("bash");
      await vi.advanceTimersByTimeAsync(1000);

      // Initial message sent with running tool status
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.sendMessage.mock.calls[0][1]).toMatch(/Running/);
      const messageId = 101;

      // Finalize without any tokens added
      await throttler.finalize();

      // Should have edited the message to clear the running tool badge
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        12345,
        messageId,
        expect.stringContaining("Done"),
        { parse_mode: "MarkdownV2" }
      );
      const editedText = mockApi.editMessageText.mock.calls[0][2];
      expect(editedText).not.toMatch(/Running/);
    });

    it("is idempotent when finalize is called multiple times", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Idempotent test");
      await throttler.finalize();
      await throttler.finalize();

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("Slice 7: Abort", () => {
    it("immediately halts throttling and typing loops on abort", async () => {
      const mockApi = createMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        typingIntervalMs: 4000,
      });

      throttler.feed("This text should not be flushed");
      await throttler.abort();

      expect(throttler.isAborted).toBe(true);

      // Advance timers by 10s
      await vi.advanceTimersByTimeAsync(10000);

      // Neither message sending nor edit should have happened
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(0);
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(0);
      // Typing action should have stopped after the initial one
      expect(mockApi.sendChatAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("Slice 8: Rich Message Draft Streaming", () => {
    it("calls sendRichMessageDraft with unique draftId and parsed InputRichMessage on throttle tick", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("# Heading 1\n\nSome introductory text.");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      const [chatId, draftId, richMessage] = mockApi.sendRichMessageDraft.mock.calls[0];
      expect(chatId).toBe(12345);
      expect(typeof draftId).toBe("number");
      expect(draftId).toBeGreaterThan(0);
      expect(throttler.draftId).toBe(draftId);

      expect(richMessage).toHaveProperty("blocks");
      expect(richMessage.blocks.length).toBe(2);
      expect(richMessage.blocks[0]).toMatchObject({
        type: "heading",
        size: 1,
        text: "Heading 1",
      });
      expect(richMessage.blocks[1]).toMatchObject({
        type: "paragraph",
        text: "Some introductory text.",
      });

      // Classic methods should not be called
      expect(mockApi.sendMessage).not.toHaveBeenCalled();
      expect(mockApi.editMessageText).not.toHaveBeenCalled();
    });

    it("reuses the same draftId across consecutive throttle ticks", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Token 1");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      const firstDraftId = mockApi.sendRichMessageDraft.mock.calls[0][1];

      throttler.feed(" Token 2");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(2);
      const secondDraftId = mockApi.sendRichMessageDraft.mock.calls[1][1];

      expect(firstDraftId).toBe(secondDraftId);
      expect(throttler.draftId).toBe(firstDraftId);
    });

    it("respects custom initial draftId if provided in options", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        draftId: 777888,
      });

      throttler.feed("Custom draft ID test");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      expect(mockApi.sendRichMessageDraft.mock.calls[0][1]).toBe(777888);
      expect(throttler.draftId).toBe(777888);
    });
  });

  describe("Slice 9: Thinking Block Injection in Rich Drafts", () => {
    it("injects InputRichBlockThinking block when currentToolStatus is active", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Searching repository files...");
      throttler.setToolStatus("ripgrep");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      const richMessage = mockApi.sendRichMessageDraft.mock.calls[0][2];
      expect(richMessage.blocks.length).toBe(2);
      expect(richMessage.blocks[0]).toMatchObject({
        type: "paragraph",
        text: "Searching repository files...",
      });
      expect(richMessage.blocks[1]).toEqual({
        type: "thinking",
        text: "⚙️ Running: ripgrep...",
      });
    });

    it("removes thinking block once tool status is cleared", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Thinking about task");
      throttler.setToolStatus("bash");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      expect(mockApi.sendRichMessageDraft.mock.calls[0][2].blocks).toHaveLength(2);

      throttler.setToolStatus(null);
      throttler.feed("\n\nTask executed successfully.");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(2);
      const secondBlocks = mockApi.sendRichMessageDraft.mock.calls[1][2].blocks;
      const thinkingBlocks = secondBlocks.filter((b: { type: string }) => b.type === "thinking");
      expect(thinkingBlocks).toHaveLength(0);
    });

    it("sends draft with only thinking block when buffer is empty but tool status is active", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.setToolStatus("agent_eval");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      const richMessage = mockApi.sendRichMessageDraft.mock.calls[0][2];
      expect(richMessage.blocks).toEqual([
        {
          type: "thinking",
          text: "⚙️ Running: agent_eval...",
        },
      ]);
    });
  });

  describe("Slice 10: Rich Message Finalization", () => {
    it("calls sendRichMessage with converted InputRichMessage and marks throttler finalized", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("```ts\nconst x = 42;\n```");
      await throttler.finalize();

      expect(mockApi.sendRichMessage).toHaveBeenCalledTimes(1);
      const [chatId, richMessage] = mockApi.sendRichMessage.mock.calls[0];
      expect(chatId).toBe(12345);
      expect(richMessage.blocks).toEqual([
        {
          type: "pre",
          language: "ts",
          text: "const x = 42;",
        },
      ]);
      expect(throttler.isFinalized).toBe(true);

      // Verify timers cleared - advancing time produces no calls
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockApi.sendRichMessageDraft).not.toHaveBeenCalled();
      expect(mockApi.sendRichMessage).toHaveBeenCalledTimes(1);
    });

    it("does not include thinking block in final sendRichMessage", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Operation complete.");
      throttler.setToolStatus("bash");

      await throttler.finalize();

      expect(mockApi.sendRichMessage).toHaveBeenCalledTimes(1);
      const richMessage = mockApi.sendRichMessage.mock.calls[0][1];
      const hasThinking = richMessage.blocks.some((b: { type: string }) => b.type === "thinking");
      expect(hasThinking).toBe(false);
      expect(richMessage.blocks[0]).toMatchObject({
        type: "paragraph",
        text: "Operation complete.",
      });
    });

    it("does not call sendRichMessage when finalizing with an empty buffer", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      await throttler.finalize();

      expect(mockApi.sendRichMessage).not.toHaveBeenCalled();
      expect(throttler.isFinalized).toBe(true);
    });
  });

  describe("Slice 11: Two-Tier Resilient Fallback", () => {
    it("falls back to classic sendMessage / editMessageText when sendRichMessageDraft fails", async () => {
      const mockApi = createRichMockApi();
      mockApi.sendRichMessageDraft.mockRejectedValueOnce(new Error("Chat does not support rich drafts"));

      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Hello fallback!");
      await vi.advanceTimersByTimeAsync(1000);

      // sendRichMessageDraft was attempted and failed
      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      // Immediately fell back to classic sendMessage in the same tick
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining("Hello fallback"),
        { parse_mode: "MarkdownV2" }
      );

      // Next tick uses classic editMessageText, not rich drafts
      throttler.feed(" Continued.");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1); // not called again
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("falls back to classic sendMessage when sendRichMessage fails during finalize", async () => {
      const mockApi = createRichMockApi();
      mockApi.sendRichMessage.mockRejectedValueOnce(new Error("API Error: Rich message rejected"));

      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Final text fallback");
      await throttler.finalize();

      expect(mockApi.sendRichMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining("Final text fallback"),
        { parse_mode: "MarkdownV2" }
      );
      expect(throttler.isFinalized).toBe(true);
    });

    it("executes secondary tier fallback to plain text if classic MarkdownV2 fails with entity error", async () => {
      const mockApi = createRichMockApi();
      mockApi.sendRichMessageDraft.mockRejectedValueOnce(new Error("Rich draft unsupported"));
      // Classic sendMessage rejects first with MarkdownV2 parse error
      mockApi.sendMessage
        .mockRejectedValueOnce(new Error("Bad Request: can't parse entities in message"))
        .mockResolvedValueOnce({ message_id: 301, text: "plain", options: undefined });

      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("*broken markdown");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).toHaveBeenCalledTimes(1);
      // sendMessage was called twice: 1st with MarkdownV2, 2nd as plain unformatted text
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockApi.sendMessage.mock.calls[0][2]).toEqual({ parse_mode: "MarkdownV2" });
      expect(mockApi.sendMessage.mock.calls[1][2]).toBeUndefined();
    });

    it("respects useRichMessages: false or enableRichMessages: false to disable rich mode", async () => {
      const mockApi = createRichMockApi();
      const throttler = new StreamThrottler(mockApi, 12345, {
        throttleMs: 1000,
        useRichMessages: false,
      });

      throttler.feed("Classic mode forced");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendRichMessageDraft).not.toHaveBeenCalled();
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);

      await throttler.finalize();
      expect(mockApi.sendRichMessage).not.toHaveBeenCalled();
    });

    it("defaults to classic mode if rich methods are not available on TelegramApiLike", async () => {
      const mockApi = createMockApi(); // No sendRichMessage or sendRichMessageDraft
      const throttler = new StreamThrottler(mockApi, 12345, { throttleMs: 1000 });

      throttler.feed("Classic default without rich methods");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
      await throttler.finalize();
      expect(throttler.isFinalized).toBe(true);
    });

    it("disables rich mode if either sendRichMessageDraft or sendRichMessage is missing", async () => {
      const mockApiDraftOnly = {
        ...createMockApi(),
        sendRichMessageDraft: vi.fn(),
      };
      const throttler1 = new StreamThrottler(mockApiDraftOnly, 12345, { throttleMs: 1000 });
      throttler1.feed("Hello");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApiDraftOnly.sendRichMessageDraft).not.toHaveBeenCalled();
      expect(mockApiDraftOnly.sendMessage).toHaveBeenCalledTimes(1);

      const mockApiFinalOnly = {
        ...createMockApi(),
        sendRichMessage: vi.fn(),
      };
      const throttler2 = new StreamThrottler(mockApiFinalOnly, 12345, { throttleMs: 1000 });
      throttler2.feed("Hello");
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApiFinalOnly.sendMessage).toHaveBeenCalledTimes(1);
      await throttler2.finalize();
      expect(mockApiFinalOnly.sendRichMessage).not.toHaveBeenCalled();
      expect(mockApiFinalOnly.editMessageText).toHaveBeenCalledTimes(1);
    });
  });
});
