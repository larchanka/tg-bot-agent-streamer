import { describe, it, expect } from "vitest";
import { isMarkdownTable, parseMarkdownTable } from "../src/telegram/rich-table.js";

describe("rich-table parser", () => {
  describe("Slice 1: invalid / non-table inputs", () => {
    it("returns false and null for empty string or whitespace", () => {
      expect(isMarkdownTable("")).toBe(false);
      expect(isMarkdownTable("   \n\n  ")).toBe(false);
      expect(parseMarkdownTable("")).toBeNull();
      expect(parseMarkdownTable("   \n\n  ")).toBeNull();
    });

    it("returns false and null for regular text without table structure", () => {
      const text = "This is just a regular paragraph.\nWith two lines.";
      expect(isMarkdownTable(text)).toBe(false);
      expect(parseMarkdownTable(text)).toBeNull();
    });

    it("returns false and null when delimiter row is missing", () => {
      const text = "| Header 1 | Header 2 |\n| Value 1 | Value 2 |";
      expect(isMarkdownTable(text)).toBe(false);
      expect(parseMarkdownTable(text)).toBeNull();
    });
  });

  describe("Slice 2: basic 2x2 table with default options", () => {
    it("parses header row and body row into InputRichBlockTable", () => {
      const table = `
| Name | Age |
| --- | --- |
| Alice | 30 |
`.trim();

      expect(isMarkdownTable(table)).toBe(true);
      const parsed = parseMarkdownTable(table);
      expect(parsed).toEqual({
        type: "table",
        is_bordered: true,
        is_striped: true,
        is_compact: true,
        cells: [
          [
            { is_header: true, align: "left", valign: "top", text: "Name" },
            { is_header: true, align: "left", valign: "top", text: "Age" },
          ],
          [
            { align: "left", valign: "top", text: "Alice" },
            { align: "left", valign: "top", text: "30" },
          ],
        ],
      });
    });
  });

  describe("Slice 3: column alignments", () => {
    it("correctly identifies left, center, and right alignments", () => {
      const table = `
| Left | Center | Right | Default |
| :--- | :---: | ---: | ------- |
| L1   | C1     | R1   | D1      |
`.trim();

      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      const cells = parsed!.cells;
      expect(cells[0][0].align).toBe("left");
      expect(cells[0][1].align).toBe("center");
      expect(cells[0][2].align).toBe("right");
      expect(cells[0][3].align).toBe("left");

      expect(cells[1][0].align).toBe("left");
      expect(cells[1][1].align).toBe("center");
      expect(cells[1][2].align).toBe("right");
      expect(cells[1][3].align).toBe("left");
    });

    it("supports short delimiter colons (e.g. :-: or -:)", () => {
      const table = `
| A | B | C |
| :- | :-: | -: |
| 1 | 2 | 3 |
`.trim();

      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      expect(parsed!.cells[0].map((c) => c.align)).toEqual(["left", "center", "right"]);
    });
  });

  describe("Slice 4: inline markdown formatting inside cells", () => {
    it("parses bold, italic, code, and links in table cells", () => {
      const table = `
| Command | Description | Link |
| --- | --- | --- |
| \`git status\` | **Shows** _modified_ files | [GitHub](https://github.com) |
`.trim();

      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      const bodyCells = parsed!.cells[1];

      // Cell 0: inline code `git status`
      expect(bodyCells[0].text).toEqual({
        type: "code",
        text: "git status",
      });

      // Cell 1: "**Shows** _modified_ files"
      expect(bodyCells[1].text).toEqual([
        { type: "bold", text: "Shows" },
        " ",
        { type: "italic", text: "modified" },
        " files",
      ]);

      // Cell 2: link [GitHub](https://github.com)
      expect(bodyCells[2].text).toEqual({
        type: "url",
        text: "GitHub",
        url: "https://github.com",
      });
    });
  });

  describe("Slice 5: table options customization", () => {
    const simpleTable = `
| A | B |
| - | - |
| 1 | 2 |
`.trim();

    it("respects false overrides for bordered, striped, and compact", () => {
      const parsed = parseMarkdownTable(simpleTable, {
        is_bordered: false,
        is_striped: false,
        is_compact: false,
      });

      expect(parsed).not.toBeNull();
      expect(parsed!.is_bordered).toBeUndefined();
      expect(parsed!.is_striped).toBeUndefined();
      expect(parsed!.is_compact).toBeUndefined();
    });

    it("attaches caption when provided", () => {
      const parsed = parseMarkdownTable(simpleTable, {
        caption: "Table 1. Overview",
      });

      expect(parsed).not.toBeNull();
      expect(parsed!.caption).toBe("Table 1. Overview");
    });

    it("customizes valign when specified", () => {
      const parsed = parseMarkdownTable(simpleTable, {
        valign: "middle",
      });

      expect(parsed).not.toBeNull();
      expect(parsed!.cells[0][0].valign).toBe("middle");
      expect(parsed!.cells[1][0].valign).toBe("middle");
    });
  });

  describe("Slice 6: robustness & edge cases", () => {
    it("handles escaped pipes inside cells without splitting", () => {
      const table = `
| Op | Syntax | Description |
| --- | :---: | --- |
| Pipe | a \\| b | Bitwise OR |
| Backslash | a \\\\ b | Escaped backslash |
`.trim();

      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      const rows = parsed!.cells;
      expect(rows).toHaveLength(3);

      // Verify row 1 cells
      expect(rows[1][0].text).toBe("Pipe");
      expect(rows[1][1].text).toBe("a | b");
      expect(rows[1][2].text).toBe("Bitwise OR");

      // Verify row 2 cells
      expect(rows[2][0].text).toBe("Backslash");
      expect(rows[2][1].text).toBe("a \\ b");
      expect(rows[2][2].text).toBe("Escaped backslash");
    });

    it("handles tables without leading and trailing outer pipes", () => {
      const table = `Col 1 | Col 2\n--- | ---\nVal 1 | Val 2`;
      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      expect(parsed!.cells).toHaveLength(2);
      expect(parsed!.cells[0][0].text).toBe("Col 1");
      expect(parsed!.cells[0][1].text).toBe("Col 2");
      expect(parsed!.cells[1][0].text).toBe("Val 1");
      expect(parsed!.cells[1][1].text).toBe("Val 2");
    });

    it("pads rows with fewer cells than column count", () => {
      const table = `
| A | B | C |
| --- | :---: | ---: |
| 1 |
| 2 | 3 |
`.trim();

      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      const rows = parsed!.cells;
      // Row 1 only provided 1 cell, should be padded to 3 cells
      expect(rows[1]).toHaveLength(3);
      expect(rows[1][0]).toEqual({ align: "left", valign: "top", text: "1" });
      expect(rows[1][1]).toEqual({ align: "center", valign: "top", text: "" });
      expect(rows[1][2]).toEqual({ align: "right", valign: "top", text: "" });

      // Row 2 provided 2 cells, padded to 3
      expect(rows[2]).toHaveLength(3);
      expect(rows[2][0]).toEqual({ align: "left", valign: "top", text: "2" });
      expect(rows[2][1]).toEqual({ align: "center", valign: "top", text: "3" });
      expect(rows[2][2]).toEqual({ align: "right", valign: "top", text: "" });
    });

    it("truncates rows that have more cells than column count", () => {
      const table = `
| A | B |
| --- | --- |
| 1 | 2 | 3 | 4 |
`.trim();

      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      const rows = parsed!.cells;
      expect(rows[1]).toHaveLength(2);
      expect(rows[1][0].text).toBe("1");
      expect(rows[1][1].text).toBe("2");
    });

    it("returns null when delimiter row contains invalid characters", () => {
      const invalid1 = `
| Col 1 | Col 2 |
| :--abc | --- |
| Val 1 | Val 2 |
`.trim();

      const invalid2 = `
| Col 1 | Col 2 |
| === | === |
| Val 1 | Val 2 |
`.trim();

      expect(parseMarkdownTable(invalid1)).toBeNull();
      expect(isMarkdownTable(invalid1)).toBe(false);

      expect(parseMarkdownTable(invalid2)).toBeNull();
      expect(isMarkdownTable(invalid2)).toBe(false);
    });

    it("handles table surrounded by blank lines and extra whitespace", () => {
      const table = `
  
| A | B |
| - | - |
| 1 | 2 |
   
`;
      expect(isMarkdownTable(table)).toBe(true);
      const parsed = parseMarkdownTable(table);
      expect(parsed).not.toBeNull();
      expect(parsed!.cells).toHaveLength(2);
    });
  });
});
