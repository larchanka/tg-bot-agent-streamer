import { describe, it, expect } from "vitest";
import { parseMarkdownToRichMessage } from "../src/telegram/rich-parser.js";

describe("rich-parser", () => {
  describe("Slice 1: Empty input & Paragraphs", () => {
    it("returns empty blocks for empty or whitespace-only markdown", () => {
      expect(parseMarkdownToRichMessage("")).toEqual({ blocks: [] });
      expect(parseMarkdownToRichMessage("   \n\n\t  \n")).toEqual({ blocks: [] });
    });

    it("parses single-line plain paragraph", () => {
      const result = parseMarkdownToRichMessage("Hello Telegram");
      expect(result).toEqual({
        blocks: [
          {
            type: "paragraph",
            text: "Hello Telegram",
          },
        ],
      });
    });

    it("parses paragraph with inline rich text formatting", () => {
      const result = parseMarkdownToRichMessage("Hello **bold** and *italic*");
      expect(result).toEqual({
        blocks: [
          {
            type: "paragraph",
            text: [
              "Hello ",
              { type: "bold", text: "bold" },
              " and ",
              { type: "italic", text: "italic" },
            ],
          },
        ],
      });
    });

    it("merges multi-line paragraphs separated by a single newline", () => {
      const result = parseMarkdownToRichMessage("Line 1\nLine 2\nLine 3");
      expect(result).toEqual({
        blocks: [
          {
            type: "paragraph",
            text: "Line 1\nLine 2\nLine 3",
          },
        ],
      });
    });

    it("separates multiple paragraphs delimited by double newlines", () => {
      const result = parseMarkdownToRichMessage("Paragraph 1\n\nParagraph 2");
      expect(result).toEqual({
        blocks: [
          {
            type: "paragraph",
            text: "Paragraph 1",
          },
          {
            type: "paragraph",
            text: "Paragraph 2",
          },
        ],
      });
    });
  });

  describe("Slice 2: Section Headings", () => {
    it("parses headings from level 1 to level 6", () => {
      const md = `
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
`.trim();

      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        { type: "heading", size: 1, text: "Heading 1" },
        { type: "heading", size: 2, text: "Heading 2" },
        { type: "heading", size: 3, text: "Heading 3" },
        { type: "heading", size: 4, text: "Heading 4" },
        { type: "heading", size: 5, text: "Heading 5" },
        { type: "heading", size: 6, text: "Heading 6" },
      ]);
    });

    it("parses headings with inline formatting", () => {
      const md = "# Title with **bold** and `code`";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "heading",
          size: 1,
          text: [
            "Title with ",
            { type: "bold", text: "bold" },
            " and ",
            { type: "code", text: "code" },
          ],
        },
      ]);
    });

    it("terminates paragraph when a heading immediately follows without blank line", () => {
      const md = "Introductory line\n## Subheading\nFollow-up text";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        { type: "paragraph", text: "Introductory line" },
        { type: "heading", size: 2, text: "Subheading" },
        { type: "paragraph", text: "Follow-up text" },
      ]);
    });
  });

  describe("Slice 3: Dividers", () => {
    it("parses horizontal rules with ---, ***, and ___", () => {
      const md = "Section 1\n---\nSection 2\n***\nSection 3\n___\nSection 4";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        { type: "paragraph", text: "Section 1" },
        { type: "divider" },
        { type: "paragraph", text: "Section 2" },
        { type: "divider" },
        { type: "paragraph", text: "Section 3" },
        { type: "divider" },
        { type: "paragraph", text: "Section 4" },
      ]);
    });

    it("parses standalone divider with surrounding whitespace", () => {
      const md = "   ---   ";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([{ type: "divider" }]);
    });
  });

  describe("Slice 4: Preformatted Code Blocks", () => {
    it("parses fenced code block with language identifier", () => {
      const md = "```typescript\nconst x: number = 42;\nconsole.log(x);\n```";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "pre",
          language: "typescript",
          text: "const x: number = 42;\nconsole.log(x);",
        },
      ]);
    });

    it("parses fenced code block without language", () => {
      const md = "```\nplain code line\n```";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "pre",
          text: "plain code line",
        },
      ]);
    });

    it("parses code block fenced with tildes ~~~", () => {
      const md = "~~~python\ndef hello():\n    return 'hi'\n~~~";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "pre",
          language: "python",
          text: "def hello():\n    return 'hi'",
        },
      ]);
    });

    it("handles unclosed code block during streaming without crashing", () => {
      const md = "```json\n{\n  \"key\": \"value\"";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "pre",
          language: "json",
          text: "{\n  \"key\": \"value\"",
        },
      ]);
    });
  });

  describe("Slice 5: AI Thinking Blocks", () => {
    it("parses single-line <thinking> block", () => {
      const md = "<thinking>Analyzing user prompt and planning tool calls...</thinking>";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "thinking",
          text: "Analyzing user prompt and planning tool calls...",
        },
      ]);
    });

    it("parses multi-line <tg-thinking> tag", () => {
      const md = "<tg-thinking>\nLine 1\nLine 2\n</tg-thinking>";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "thinking",
          text: "Line 1\nLine 2",
        },
      ]);
    });

    it("parses unclosed streaming thinking block without throwing", () => {
      const md = "<thinking>\nStep 1: Fetching database schema";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "thinking",
          text: "Step 1: Fetching database schema",
        },
      ]);
    });
  });

  describe("Slice 6: GFM Tables", () => {
    it("parses GFM table into InputRichBlockTable", () => {
      const md = `
| Header 1 | Header 2 |
| :------- | -------: |
| Left     | Right    |
`.trim();

      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "table",
          is_bordered: true,
          is_striped: true,
          is_compact: true,
          cells: [
            [
              { is_header: true, align: "left", valign: "top", text: "Header 1" },
              { is_header: true, align: "right", valign: "top", text: "Header 2" },
            ],
            [
              { align: "left", valign: "top", text: "Left" },
              { align: "right", valign: "top", text: "Right" },
            ],
          ],
        },
      ]);
    });

    it("passes through tableOptions to parseMarkdownTable", () => {
      const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
      const result = parseMarkdownToRichMessage(md, {
        tableOptions: { is_bordered: false, is_compact: false },
      });
      const table = result.blocks[0] as any;
      expect(table.type).toBe("table");
      expect(table.is_striped).toBe(true);
      expect(table.is_bordered).toBeUndefined();
      expect(table.is_compact).toBeUndefined();
    });

    it("terminates paragraph when a table starts immediately after", () => {
      const md = "Here is the table:\n| Col 1 | Col 2 |\n| --- | --- |\n| Val 1 | Val 2 |";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0]).toEqual({
        type: "paragraph",
        text: "Here is the table:",
      });
      expect(result.blocks[1].type).toBe("table");
    });
  });

  describe("Slice 7: Blockquotes", () => {
    it("parses single-line and multi-line blockquotes", () => {
      const md = "> This is a quote\n> Continued on line 2";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "blockquote",
          blocks: [
            {
              type: "paragraph",
              text: "This is a quote\nContinued on line 2",
            },
          ],
        },
      ]);
    });

    it("parses blockquotes with inline formatting", () => {
      const md = "> Quote with **bold** and *italic* text";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "blockquote",
          blocks: [
            {
              type: "paragraph",
              text: [
                "Quote with ",
                { type: "bold", text: "bold" },
                " and ",
                { type: "italic", text: "italic" },
                " text",
              ],
            },
          ],
        },
      ]);
    });

    it("terminates paragraph when blockquote immediately follows", () => {
      const md = "Intro:\n> Quoted block";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        { type: "paragraph", text: "Intro:" },
        {
          type: "blockquote",
          blocks: [
            {
              type: "paragraph",
              text: "Quoted block",
            },
          ],
        },
      ]);
    });
  });

  describe("Slice 8: Lists (bullet, numbered, and task lists)", () => {
    it("parses unordered bullet list (-, *, +)", () => {
      const md = "- First item\n* Second item\n+ Third item";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "list",
          items: [
            {
              blocks: [{ type: "paragraph", text: "First item" }],
            },
            {
              blocks: [{ type: "paragraph", text: "Second item" }],
            },
            {
              blocks: [{ type: "paragraph", text: "Third item" }],
            },
          ],
        },
      ]);
    });

    it("parses ordered numbered list with numeric value", () => {
      const md = "1. First step\n2. Second step\n3. Third step";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "list",
          items: [
            {
              type: "1",
              value: 1,
              blocks: [{ type: "paragraph", text: "First step" }],
            },
            {
              type: "1",
              value: 2,
              blocks: [{ type: "paragraph", text: "Second step" }],
            },
            {
              type: "1",
              value: 3,
              blocks: [{ type: "paragraph", text: "Third step" }],
            },
          ],
        },
      ]);
    });

    it("parses task list items with unchecked and checked checkboxes", () => {
      const md = "- [ ] Incomplete task\n- [x] Completed task\n- [X] Another completed";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "list",
          items: [
            {
              has_checkbox: true,
              blocks: [{ type: "paragraph", text: "Incomplete task" }],
            },
            {
              has_checkbox: true,
              is_checked: true,
              blocks: [{ type: "paragraph", text: "Completed task" }],
            },
            {
              has_checkbox: true,
              is_checked: true,
              blocks: [{ type: "paragraph", text: "Another completed" }],
            },
          ],
        },
      ]);
    });

    it("terminates paragraph when list starts immediately after", () => {
      const md = "Tasks to do:\n- Item 1\n- Item 2";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0]).toEqual({
        type: "paragraph",
        text: "Tasks to do:",
      });
      expect(result.blocks[1].type).toBe("list");
    });
  });

  describe("Slice 9: Expandable Details", () => {
    it("parses <details> with <summary> and body content", () => {
      const md = `
<details>
<summary>Click to view logs</summary>
Log line 1
Log line 2
</details>
`.trim();

      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "details",
          summary: "Click to view logs",
          blocks: [
            {
              type: "paragraph",
              text: "Log line 1\nLog line 2",
            },
          ],
        },
      ]);
    });

    it("parses <details open> with is_open: true flag", () => {
      const md = "<details open><summary>**Important Info**</summary>\nContent\n</details>";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "details",
          is_open: true,
          summary: { type: "bold", text: "Important Info" },
          blocks: [
            {
              type: "paragraph",
              text: "Content",
            },
          ],
        },
      ]);
    });

    it("handles unclosed <details> block during streaming without crashing", () => {
      const md = "<details><summary>In-flight trace</summary>\nPartial stack trace...";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks).toEqual([
        {
          type: "details",
          summary: "In-flight trace",
          blocks: [
            {
              type: "paragraph",
              text: "Partial stack trace...",
            },
          ],
        },
      ]);
    });

    it("terminates paragraph when <details> starts immediately after", () => {
      const md = "Header text\n<details><summary>More</summary>\nHidden\n</details>";
      const result = parseMarkdownToRichMessage(md);
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0]).toEqual({
        type: "paragraph",
        text: "Header text",
      });
      expect(result.blocks[1].type).toBe("details");
    });
  });

  describe("Slice 10: Complex Mixed Documents & Edge Cases", () => {
    it("parses a comprehensive markdown document with multiple block types in sequence", () => {
      const doc = `
# Release Notes v2.0

<thinking>
Preparing release notes summary...
</thinking>

Here is the summary of recent changes:

- [x] Initial protocol setup
- [ ] Rich message integration

---

### Performance Benchmarks

| Metric | Previous | Current |
| :--- | :---: | ---: |
| Latency | 120ms | 45ms |
| Memory | 250MB | 110MB |

> Quality is not an act, it is a habit.

\`\`\`typescript
export function run(): void {
  console.log("ready");
}
\`\`\`

<details>
<summary>Trace logs</summary>
All systems operational
</details>
`.trim();

      const result = parseMarkdownToRichMessage(doc);
      expect(result.blocks.length).toBe(10);
      expect(result.blocks[0]).toEqual({
        type: "heading",
        size: 1,
        text: "Release Notes v2.0",
      });
      expect(result.blocks[1]).toEqual({
        type: "thinking",
        text: "Preparing release notes summary...",
      });
      expect(result.blocks[2]).toEqual({
        type: "paragraph",
        text: "Here is the summary of recent changes:",
      });
      expect(result.blocks[3]).toEqual({
        type: "list",
        items: [
          {
            has_checkbox: true,
            is_checked: true,
            blocks: [{ type: "paragraph", text: "Initial protocol setup" }],
          },
          {
            has_checkbox: true,
            blocks: [{ type: "paragraph", text: "Rich message integration" }],
          },
        ],
      });
      expect(result.blocks[4]).toEqual({ type: "divider" });
      expect(result.blocks[5]).toEqual({
        type: "heading",
        size: 3,
        text: "Performance Benchmarks",
      });
      expect(result.blocks[6].type).toBe("table");
      expect(result.blocks[7]).toEqual({
        type: "blockquote",
        blocks: [
          {
            type: "paragraph",
            text: "Quality is not an act, it is a habit.",
          },
        ],
      });
      expect(result.blocks[8]).toEqual({
        type: "pre",
        language: "typescript",
        text: 'export function run(): void {\n  console.log("ready");\n}',
      });
      expect(result.blocks[9]).toEqual({
        type: "details",
        summary: "Trace logs",
        blocks: [
          {
            type: "paragraph",
            text: "All systems operational",
          },
        ],
      });
    });
  });
});
