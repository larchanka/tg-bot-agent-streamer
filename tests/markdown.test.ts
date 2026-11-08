import { describe, it, expect } from "vitest";
import {
  balanceMarkdown,
  formatTelegramMarkdown,
  stripMarkdown,
  formatStreamingChunk,
} from "../src/telegram/markdown.js";

describe("balanceMarkdown - Code Blocks", () => {
  it("balances unclosed code block starting with ```", () => {
    const input = "```";
    expect(balanceMarkdown(input)).toBe("```\n```\n");
  });

  it("balances unclosed code block starting with ```lang", () => {
    const input = "```typescript";
    expect(balanceMarkdown(input)).toBe("```typescript\n```\n");
  });

  it("balances unclosed code block with code content", () => {
    const input = "```typescript\nconst x = 1";
    expect(balanceMarkdown(input)).toBe("```typescript\nconst x = 1\n```\n");
  });

  it("preserves already closed code blocks", () => {
    const input = "```typescript\nconst x = 1;\n```";
    expect(balanceMarkdown(input)).toBe("```typescript\nconst x = 1;\n```");
  });

  it("does not balance inline tags inside unclosed code blocks", () => {
    const input = "```typescript\nconst x = *y*;";
    expect(balanceMarkdown(input)).toBe("```typescript\nconst x = *y*;\n```\n");
  });
});

describe("balanceMarkdown - Inline Formatting", () => {
  it("balances unclosed inline code", () => {
    expect(balanceMarkdown("hello `code")).toBe("hello `code`");
    expect(balanceMarkdown("`first` and `second")).toBe("`first` and `second`");
  });

  it("does not balance inside inline code", () => {
    expect(balanceMarkdown("`const x = *y*;")).toBe("`const x = *y*;`");
  });

  it("balances unclosed bold", () => {
    expect(balanceMarkdown("**bold")).toBe("**bold**");
    expect(balanceMarkdown("prefix **bold text")).toBe("prefix **bold text**");
  });

  it("balances unclosed italic (* and _)", () => {
    expect(balanceMarkdown("*italic")).toBe("*italic*");
    expect(balanceMarkdown("_italic")).toBe("_italic_");
  });

  it("balances unclosed spoiler", () => {
    expect(balanceMarkdown("||secret")).toBe("||secret||");
    expect(balanceMarkdown("reveal ||secret text")).toBe("reveal ||secret text||");
  });

  it("balances unclosed strikethrough (~ and ~~)", () => {
    expect(balanceMarkdown("~strike")).toBe("~strike~");
    expect(balanceMarkdown("~~strike")).toBe("~~strike~~");
  });

  it("balances nested unclosed markers in LIFO order", () => {
    expect(balanceMarkdown("**bold _italic")).toBe("**bold _italic_**");
    expect(balanceMarkdown("**bold *italic")).toBe("**bold *italic***");
  });

  it("preserves already balanced inline formatting", () => {
    const input = "**bold** and *italic* and _italic_ and `code` and ||spoiler|| and ~strike~";
    expect(balanceMarkdown(input)).toBe(input);
  });

  it("ignores escaped formatting markers", () => {
    expect(balanceMarkdown("\\*not italic")).toBe("\\*not italic");
    expect(balanceMarkdown("\\`not code")).toBe("\\`not code");
    expect(balanceMarkdown("\\*\\*not bold")).toBe("\\*\\*not bold");
  });

  it("does not treat underscores inside identifiers as italics", () => {
    expect(balanceMarkdown("const user_id = 42;")).toBe("const user_id = 42;");
    expect(balanceMarkdown("var_one and var_two")).toBe("var_one and var_two");
  });

  it("does not treat arithmetic multiplication as italics", () => {
    expect(balanceMarkdown("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("balances inline formatting after closed code blocks", () => {
    const input = "```js\nconsole.log(1);\n```\n**bold";
    expect(balanceMarkdown(input)).toBe("```js\nconsole.log(1);\n```\n**bold**");
  });
});

describe("formatTelegramMarkdown", () => {
  it("formats complete markdown to Telegram MarkdownV2", () => {
    const result = formatTelegramMarkdown("**bold** and *italic* and `code`");
    expect(result).toContain("*bold*");
    expect(result).toContain("`code`");
  });

  it("formats partial markdown by balancing before conversion", () => {
    const result = formatTelegramMarkdown("**bold in progress", true);
    expect(result).toContain("*bold in progress*");
  });

  it("handles unclosed code block in partial mode", () => {
    const result = formatTelegramMarkdown("```typescript\nconst x = 1;", true);
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });
});

describe("stripMarkdown", () => {
  it("returns plain text unchanged", () => {
    expect(stripMarkdown("Hello world!")).toBe("Hello world!");
  });

  it("strips bold, italic, spoilers, and strikethrough", () => {
    const input = "**bold** and *italic* and _italic2_ and ||spoiler|| and ~strike~ and ~~strike2~~";
    expect(stripMarkdown(input)).toBe("bold and italic and italic2 and spoiler and strike and strike2");
  });

  it("strips inline code and code block fences", () => {
    const input = "Here is `inline code` and:\n```python\nprint('hello')\n```";
    expect(stripMarkdown(input)).toBe("Here is inline code and:\nprint('hello')");
  });

  it("strips unclosed markdown formatting", () => {
    expect(stripMarkdown("**bold in progress")).toBe("bold in progress");
    expect(stripMarkdown("`code in progress")).toBe("code in progress");
    expect(stripMarkdown("||secret in progress")).toBe("secret in progress");
    expect(stripMarkdown("```python\nprint(123)")).toBe("print(123)");
  });

  it("formats markdown links into readable plain text", () => {
    expect(stripMarkdown("[Example](https://example.com)")).toBe("Example (https://example.com)");
  });

  it("strips markdown headers and blockquotes", () => {
    const input = "# Title\n## Subtitle\n> A famous quote";
    expect(stripMarkdown(input)).toBe("Title\nSubtitle\nA famous quote");
  });

  it("unescapes escaped markdown punctuation", () => {
    expect(stripMarkdown("Escaped \\*asterisk\\* and \\_underscore\\_")).toBe("Escaped *asterisk* and _underscore_");
  });
});

describe("formatStreamingChunk", () => {
  it("returns both balanced markdown and plain fallback", () => {
    const input = "Streaming **bold text";
    const chunk = formatStreamingChunk(input);

    expect(chunk.markdown).toContain("*bold text*");
    expect(chunk.plain).toBe("Streaming bold text");
  });
});


