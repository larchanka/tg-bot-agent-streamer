import { describe, it, expect } from "vitest";
import { parseInlineRichText, parseRichText } from "../src/telegram/rich-text.js";
import type {
  RichText,
  RichTextBold,
  RichTextItalic,
  RichTextUnderline,
  RichTextStrikethrough,
  RichTextSpoiler,
  RichTextCode,
  RichTextUrl,
  RichTextMathematicalExpression,
} from "../src/telegram/rich-types.js";

describe("rich-text: parseInlineRichText", () => {
  describe("plain text & empty", () => {
    it("returns empty string for empty input", () => {
      expect(parseInlineRichText("")).toBe("");
    });

    it("returns plain text unchanged when there is no formatting", () => {
      expect(parseInlineRichText("Hello world")).toBe("Hello world");
    });
  });

  describe("single formatting tokens", () => {
    it("parses bold text with **", () => {
      const result = parseInlineRichText("**bold text**");
      expect(result).toEqual<RichTextBold>({
        type: "bold",
        text: "bold text",
      });
    });

    it("parses italic text with *", () => {
      const result = parseInlineRichText("*italic text*");
      expect(result).toEqual<RichTextItalic>({
        type: "italic",
        text: "italic text",
      });
    });

    it("parses italic text with _", () => {
      const result = parseInlineRichText("_italic text_");
      expect(result).toEqual<RichTextItalic>({
        type: "italic",
        text: "italic text",
      });
    });

    it("parses underline text with __", () => {
      const result = parseInlineRichText("__underlined text__");
      expect(result).toEqual<RichTextUnderline>({
        type: "underline",
        text: "underlined text",
      });
    });

    it("parses underline text with <u> HTML tags", () => {
      const result = parseInlineRichText("<u>underlined text</u>");
      expect(result).toEqual<RichTextUnderline>({
        type: "underline",
        text: "underlined text",
      });
    });

    it("parses strikethrough text with ~~", () => {
      const result = parseInlineRichText("~~strikethrough text~~");
      expect(result).toEqual<RichTextStrikethrough>({
        type: "strikethrough",
        text: "strikethrough text",
      });
    });

    it("parses strikethrough text with single ~", () => {
      const result = parseInlineRichText("~strikethrough text~");
      expect(result).toEqual<RichTextStrikethrough>({
        type: "strikethrough",
        text: "strikethrough text",
      });
    });

    it("parses spoiler text with ||", () => {
      const result = parseInlineRichText("||spoiler secret||");
      expect(result).toEqual<RichTextSpoiler>({
        type: "spoiler",
        text: "spoiler secret",
      });
    });

    it("parses inline code with backticks without parsing inside", () => {
      const result = parseInlineRichText("`const x = **not bold**;`");
      expect(result).toEqual<RichTextCode>({
        type: "code",
        text: "const x = **not bold**;",
      });
    });

    it("parses inline links [text](url)", () => {
      const result = parseInlineRichText("[OpenAI](https://openai.com)");
      expect(result).toEqual<RichTextUrl>({
        type: "url",
        text: "OpenAI",
        url: "https://openai.com",
      });
    });

    it("parses inline LaTeX mathematical expressions $...$", () => {
      const result = parseInlineRichText("$E = mc^2$");
      expect(result).toEqual<RichTextMathematicalExpression>({
        type: "mathematical_expression",
        expression: "E = mc^2",
      });
    });
  });

  describe("mixed & composite text", () => {
    it("parses mixed text with surrounding plain strings", () => {
      const result = parseInlineRichText("Hello **world**, check `this` out!");
      expect(result).toEqual([
        "Hello ",
        { type: "bold", text: "world" },
        ", check ",
        { type: "code", text: "this" },
        " out!",
      ]);
    });

    it("parses consecutive styled tokens cleanly", () => {
      const result = parseInlineRichText("**Bold** *Italic* `Code`");
      expect(result).toEqual([
        { type: "bold", text: "Bold" },
        " ",
        { type: "italic", text: "Italic" },
        " ",
        { type: "code", text: "Code" },
      ]);
    });
  });

  describe("nested formatting", () => {
    it("parses italic inside bold: **bold _italic_**", () => {
      const result = parseInlineRichText("**bold _italic_**");
      expect(result).toEqual<RichTextBold>({
        type: "bold",
        text: [
          "bold ",
          {
            type: "italic",
            text: "italic",
          },
        ],
      });
    });

    it("parses bold inside link text: [**Click here**](https://example.com)", () => {
      const result = parseInlineRichText("[**Click here**](https://example.com)");
      expect(result).toEqual<RichTextUrl>({
        type: "url",
        text: {
          type: "bold",
          text: "Click here",
        },
        url: "https://example.com",
      });
    });

    it("parses link inside bold: **[Link](https://example.com)**", () => {
      const result = parseInlineRichText("**[Link](https://example.com)**");
      expect(result).toEqual<RichTextBold>({
        type: "bold",
        text: {
          type: "url",
          text: "Link",
          url: "https://example.com",
        },
      });
    });

    it("parses deeply nested formatting: **bold *italic __underline__*** ", () => {
      const result = parseInlineRichText("**bold *italic __underline__***");
      expect(result).toEqual<RichTextBold>({
        type: "bold",
        text: [
          "bold ",
          {
            type: "italic",
            text: [
              "italic ",
              {
                type: "underline",
                text: "underline",
              },
            ],
          },
        ],
      });
    });
  });

  describe("escaped characters", () => {
    it("handles backslash escaped asterisks without formatting", () => {
      const result = parseInlineRichText("\\*not italic\\*");
      expect(result).toBe("*not italic*");
    });

    it("handles backslash escaped backticks without code formatting", () => {
      const result = parseInlineRichText("\\`not code\\`");
      expect(result).toBe("`not code`");
    });

    it("handles backslash escaped brackets without link formatting", () => {
      const result = parseInlineRichText("\\[not link\\](url)");
      expect(result).toBe("[not link](url)");
    });
  });

  describe("unclosed streaming tokens & resilience", () => {
    it("does not throw on unclosed bold in streaming chunk", () => {
      const result = parseInlineRichText("Processing **bold content");
      expect(result).toBe("Processing **bold content");
    });

    it("does not throw on unclosed code delimiter", () => {
      const result = parseInlineRichText("Here is `some unclosed code");
      expect(result).toBe("Here is `some unclosed code");
    });

    it("does not throw on unclosed spoiler", () => {
      const result = parseInlineRichText("Spoiler: ||secret");
      expect(result).toBe("Spoiler: ||secret");
    });

    it("does not throw on unclosed link syntax", () => {
      const result = parseInlineRichText("[Incomplete link](https://");
      expect(result).toBe("[Incomplete link](https://");
    });

    it("handles empty formatting tags gracefully", () => {
      const result = parseInlineRichText("****");
      expect(result).toBe("");
    });
  });

  describe("parseRichText alias", () => {
    it("functions as an alias of parseInlineRichText", () => {
      expect(parseRichText("**test**")).toEqual(parseInlineRichText("**test**"));
    });
  });
});
