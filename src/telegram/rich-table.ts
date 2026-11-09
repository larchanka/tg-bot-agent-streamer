/**
 * GitHub Flavored Markdown (GFM) table parser for Telegram Bot API 10.1+.
 * Converts markdown tables into native InputRichBlockTable structures.
 */

import { parseInlineRichText } from "./rich-text.js";
import type {
  InputRichBlockTable,
  RichBlockTableCell,
  RichText,
} from "./rich-types.js";

export type CellAlignment = "left" | "center" | "right";
export type CellVerticalAlignment = "top" | "middle" | "bottom";

export interface TableOptions {
  readonly is_bordered?: boolean;
  readonly is_striped?: boolean;
  readonly is_compact?: boolean;
  readonly caption?: RichText;
  readonly valign?: CellVerticalAlignment;
}

const DELIMITER_CELL_REGEX = /^\s*(:?)-+(:?)\s*$/;

/**
 * Splits a table row into raw cell strings by unescaped pipe characters.
 * Correctly strips outer boundary pipes if present.
 */
export function splitRowIntoCells(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const segments: string[] = [];
  let current = "";
  let backslashes = 0;
  let lastCharWasPipe = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "\\") {
      backslashes++;
      current += char;
      lastCharWasPipe = false;
    } else if (char === "|") {
      if (backslashes % 2 === 1) {
        // Escaped pipe: \|
        current += char;
        lastCharWasPipe = false;
      } else {
        segments.push(current);
        current = "";
        lastCharWasPipe = true;
      }
      backslashes = 0;
    } else {
      backslashes = 0;
      current += char;
      lastCharWasPipe = false;
    }
  }
  segments.push(current);

  const hasLeadingPipe = trimmed.startsWith("|");
  if (hasLeadingPipe && segments.length > 0) {
    segments.shift();
  }
  if (lastCharWasPipe && segments.length > 0) {
    segments.pop();
  }

  return segments;
}

/**
 * Parses a delimiter row to extract column alignments.
 * Returns null if the row is not a valid GFM table delimiter row.
 */
export function parseDelimiterRow(line: string): CellAlignment[] | null {
  const cells = splitRowIntoCells(line);
  if (cells.length === 0) {
    return null;
  }

  const alignments: CellAlignment[] = [];
  for (const cell of cells) {
    const match = DELIMITER_CELL_REGEX.exec(cell);
    if (!match) {
      return null;
    }
    const leftColon = match[1] === ":";
    const rightColon = match[2] === ":";

    if (leftColon && rightColon) {
      alignments.push("center");
    } else if (rightColon) {
      alignments.push("right");
    } else {
      alignments.push("left");
    }
  }

  return alignments;
}

/**
 * Builds a single RichBlockTableCell with alignment and parsed inline rich text.
 */
function buildCell(
  rawText: string,
  align: CellAlignment,
  valign: CellVerticalAlignment,
  isHeader: boolean
): RichBlockTableCell {
  const cell: RichBlockTableCell = {
    align,
    valign,
    text: parseInlineRichText(rawText.trim()),
  };
  if (isHeader) {
    cell.is_header = true;
  }
  return cell;
}

/**
 * Normalizes and builds a row of cells matching the target column count and alignments.
 */
function buildRow(
  rawCells: string[],
  alignments: readonly CellAlignment[],
  valign: CellVerticalAlignment,
  isHeader: boolean
): RichBlockTableCell[] {
  const row: RichBlockTableCell[] = [];
  const colCount = alignments.length;

  for (let c = 0; c < colCount; c++) {
    const rawText = c < rawCells.length ? rawCells[c] : "";
    row.push(buildCell(rawText, alignments[c], valign, isHeader));
  }

  return row;
}

/**
 * Applies optional styling attributes to the InputRichBlockTable.
 */
function applyTableOptions(
  table: InputRichBlockTable,
  options?: TableOptions
): InputRichBlockTable {
  if (options?.is_bordered !== false) {
    table.is_bordered = true;
  }
  if (options?.is_striped !== false) {
    table.is_striped = true;
  }
  if (options?.is_compact !== false) {
    table.is_compact = true;
  }
  if (options?.caption !== undefined) {
    table.caption = options.caption;
  }
  return table;
}

/**
 * Determines whether the given text is a valid Markdown table.
 */
export function isMarkdownTable(text: string): boolean {
  return parseMarkdownTable(text) !== null;
}

/**
 * Parses a GitHub Flavored Markdown table string into Telegram Bot API 10.1+ InputRichBlockTable.
 * Returns null if the markdown is not a valid table structure.
 */
export function parseMarkdownTable(
  tableMarkdown: string,
  options?: TableOptions
): InputRichBlockTable | null {
  if (!tableMarkdown || !tableMarkdown.trim()) {
    return null;
  }

  const lines = tableMarkdown
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return null;
  }

  const alignments = parseDelimiterRow(lines[1]);
  if (!alignments || alignments.length === 0) {
    return null;
  }

  const valign = options?.valign ?? "top";
  const headerCells = splitRowIntoCells(lines[0]);
  const rows: RichBlockTableCell[][] = [
    buildRow(headerCells, alignments, valign, true),
  ];

  for (let r = 2; r < lines.length; r++) {
    const bodyCells = splitRowIntoCells(lines[r]);
    rows.push(buildRow(bodyCells, alignments, valign, false));
  }

  const table: InputRichBlockTable = {
    type: "table",
    cells: rows,
  };

  return applyTableOptions(table, options);
}
