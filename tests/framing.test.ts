import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import {
  ProtocolFramer,
  JsonLineFramer,
  serializeCommand,
} from "../src/pi/framing.js";

describe("Strict LF Protocol Framer", () => {
  describe("serializeCommand", () => {
    it("serializes command object to JSON terminated strictly with LF (\\n)", () => {
      const command = { id: "req-1", type: "prompt", message: "hello" };
      const serialized = serializeCommand(command);

      expect(serialized).toBe('{"id":"req-1","type":"prompt","message":"hello"}\n');
      expect(serialized.endsWith("\n")).toBe(true);
      expect(serialized.endsWith("\r\n")).toBe(false);
    });

    it("serializes commands with unicode and special characters", () => {
      const command = {
        id: "req-unicode",
        message: "Hello \u2028 line \u2029 sep and emoji \u{1F525}",
      };
      const serialized = serializeCommand(command);

      expect(serialized.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(serialized.trim());
      expect(parsed).toEqual(command);
    });

    it("throws a TypeError when serializing undefined", () => {
      expect(() => serializeCommand(undefined)).toThrow(TypeError);
    });
  });

  describe("ProtocolFramer - Basic Line Delimiting", () => {
    it("yields a single line when complete line with \\n is received", () => {
      const framer = new ProtocolFramer();
      const lines = framer.feed('{"type":"agent_start"}\n');

      expect(lines).toEqual(['{"type":"agent_start"}']);
    });

    it("strips trailing \\r when lines are terminated by \\r\\n", () => {
      const framer = new ProtocolFramer();
      const lines = framer.feed('{"type":"turn_start"}\r\n');

      expect(lines).toEqual(['{"type":"turn_start"}']);
    });

    it("handles multiple lines in a single chunk", () => {
      const framer = new ProtocolFramer();
      const chunk = '{"id":"1"}\n{"id":"2"}\r\n{"id":"3"}\n';
      const lines = framer.feed(chunk);

      expect(lines).toEqual(['{"id":"1"}', '{"id":"2"}', '{"id":"3"}']);
    });

    it("buffers partial lines across multiple chunks", () => {
      const framer = new ProtocolFramer();

      const lines1 = framer.feed('{"type":"message_update","content":"he');
      expect(lines1).toEqual([]);
      expect(framer.getBuffer()).toBe('{"type":"message_update","content":"he');

      const lines2 = framer.feed('llo world"}\n');
      expect(lines2).toEqual(['{"type":"message_update","content":"hello world"}']);
      expect(framer.getBuffer()).toBe("");
    });

    it("handles arbitrary chunk fragment boundaries across many chunks", () => {
      const framer = new ProtocolFramer();
      const fullMessage = '{"id":"abc","result":"success"}\n';
      const receivedLines: string[] = [];

      for (const char of fullMessage) {
        const lines = framer.feed(char);
        receivedLines.push(...lines);
      }

      expect(receivedLines).toEqual(['{"id":"abc","result":"success"}']);
      expect(framer.getBuffer()).toBe("");
    });

    it("handles \\r and \\n split across chunk boundaries", () => {
      const framer = new ProtocolFramer();
      const lines1 = framer.feed('{"status":"ok"}\r');
      expect(lines1).toEqual([]);
      expect(framer.getBuffer()).toBe('{"status":"ok"}\r');

      const lines2 = framer.feed('\n');
      expect(lines2).toEqual(['{"status":"ok"}']);
      expect(framer.getBuffer()).toBe("");
    });

    it("accepts Buffer chunks in feed()", () => {
      const framer = new ProtocolFramer();
      const buffer = Buffer.from('{"chunk":"buffer"}\n', "utf-8");
      const lines = framer.feed(buffer);

      expect(lines).toEqual(['{"chunk":"buffer"}']);
    });

    it("ignores empty lines by default", () => {
      const framer = new ProtocolFramer();
      const chunk = '\n\n{"id":"1"}\n   \n\r\n{"id":"2"}\n\n';
      const lines = framer.feed(chunk);

      expect(lines).toEqual(['{"id":"1"}', '{"id":"2"}']);
    });

    it("preserves empty lines when ignoreEmpty is configured to false", () => {
      const framer = new ProtocolFramer({ ignoreEmpty: false });
      const chunk = '{"id":"1"}\n\n{"id":"2"}\n';
      const lines = framer.feed(chunk);

      expect(lines).toEqual(['{"id":"1"}', "", '{"id":"2"}']);
    });

    it("resets buffer when reset() is called", () => {
      const framer = new ProtocolFramer();
      framer.feed('{"partial":');
      expect(framer.getBuffer()).toBe('{"partial":');

      framer.reset();
      expect(framer.getBuffer()).toBe("");

      const lines = framer.feed('{"complete":true}\n');
      expect(lines).toEqual(['{"complete":true}']);
    });

    it("flushes remaining buffer on flush()", () => {
      const framer = new ProtocolFramer();
      framer.feed('{"type":"unclosed"}');

      const remaining = framer.flush();
      expect(remaining).toEqual(['{"type":"unclosed"}']);
      expect(framer.getBuffer()).toBe("");

      // Calling flush again on empty buffer returns empty array
      expect(framer.flush()).toEqual([]);
    });

    it("flushes trailing \\r properly on flush()", () => {
      const framer = new ProtocolFramer();
      framer.feed('{"type":"unclosed"}\r');

      const remaining = framer.flush();
      expect(remaining).toEqual(['{"type":"unclosed"}']);
    });

    it("flushes empty or whitespace-only trailing buffer as empty array when ignoreEmpty is true", () => {
      const framer = new ProtocolFramer({ ignoreEmpty: true });
      framer.feed("   \r");

      const remaining = framer.flush();
      expect(remaining).toEqual([]);
    });
  });

  describe("ProtocolFramer - Strict LF vs Unicode Separators (U+2028 & U+2029)", () => {
    it("preserves U+2028 (Line Separator) and U+2029 (Paragraph Separator) inside JSON payloads without splitting", () => {
      const framer = new ProtocolFramer();

      // JSON payload containing both U+2028 and U+2029
      const payload = {
        type: "message_update",
        content: "Line 1\u2028Line 2\u2029Paragraph 2",
      };
      const rawJson = JSON.stringify(payload);
      const incomingStreamChunk = rawJson + "\n";

      // Verify that rawJson contains the characters
      expect(rawJson).toContain("\u2028");
      expect(rawJson).toContain("\u2029");

      // Feed through framer
      const lines = framer.feed(incomingStreamChunk);

      // Must be emitted as exactly ONE line, not three lines!
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(rawJson);

      // Must parse back into the exact original payload
      const parsed = JSON.parse(lines[0]);
      expect(parsed).toEqual(payload);
      expect(parsed.content).toBe("Line 1\u2028Line 2\u2029Paragraph 2");
    });

    it("handles multi-byte UTF-8 split across Buffer chunks without corruption", () => {
      const framer = new ProtocolFramer();

      // U+2028 in UTF-8 is 3 bytes: 0xE2 0x80 0xA8
      const jsonPrefix = '{"text":"';
      const u2028 = "\u2028";
      const jsonSuffix = '"}\n';
      const fullBuffer = Buffer.from(jsonPrefix + u2028 + jsonSuffix, "utf-8");

      // Split right in the middle of the 3-byte UTF-8 sequence for U+2028
      const prefixLength = Buffer.from(jsonPrefix, "utf-8").length;
      const chunk1 = fullBuffer.subarray(0, prefixLength + 1); // contains first byte 0xE2
      const chunk2 = fullBuffer.subarray(prefixLength + 1);     // contains 0x80, 0xA8 and suffix

      const lines1 = framer.feed(chunk1);
      expect(lines1).toEqual([]);

      const lines2 = framer.feed(chunk2);
      expect(lines2).toHaveLength(1);

      const parsed = JSON.parse(lines2[0]);
      expect(parsed.text).toBe("\u2028");
    });
  });

  describe("ProtocolFramer - Event Emitter & Stream Integration", () => {
    it("emits 'line' event for each complete record", () => {
      const framer = new ProtocolFramer();
      const emittedLines: string[] = [];

      framer.on("line", (line) => {
        emittedLines.push(line);
      });

      framer.feed('{"a":1}\n{"b":2}\n');
      expect(emittedLines).toEqual(['{"a":1}', '{"b":2}']);
    });

    it("supports push() as an alias to feed()", () => {
      const framer = new ProtocolFramer();
      const lines = framer.push('{"alias":true}\n');
      expect(lines).toEqual(['{"alias":true}']);
    });

    it("attaches to a Readable stream and processes piped chunks until end", async () => {
      const framer = new ProtocolFramer();
      const emitted: string[] = [];
      let ended = false;

      framer.on("line", (line) => {
        emitted.push(line);
      });
      framer.on("end", () => {
        ended = true;
      });

      const readable = new Readable({
        read() {},
      });

      framer.attach(readable);

      readable.push(Buffer.from('{"step":1}\n{"step"'));
      readable.push(Buffer.from(':2}\n'));
      readable.push(null); // EOF

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(emitted).toEqual(['{"step":1}', '{"step":2}']);
      expect(ended).toBe(true);
    });

    it("aliases JsonLineFramer to ProtocolFramer", () => {
      expect(JsonLineFramer).toBe(ProtocolFramer);
      const instance = new JsonLineFramer();
      expect(instance).toBeInstanceOf(ProtocolFramer);
    });
  });
});
