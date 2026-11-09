/**
 * Full Markdown to Telegram Bot API 10.1+ InputRichMessage Block Parser.
 * Converts markdown documents into structured InputRichBlock[] representations.
 */

import { parseInlineRichText } from "./rich-text.js";
import {
  parseMarkdownTable,
  parseDelimiterRow,
  type TableOptions,
} from "./rich-table.js";
import type {
  InputRichBlock,
  InputRichBlockBlockQuotation,
  InputRichBlockDetails,
  InputRichBlockDivider,
  InputRichBlockList,
  InputRichBlockListItem,
  InputRichBlockParagraph,
  InputRichBlockPreformatted,
  InputRichBlockSectionHeading,
  InputRichBlockTable,
  InputRichBlockThinking,
  InputRichMessage,
} from "./rich-types.js";

export interface RichParserOptions {
  readonly tableOptions?: TableOptions;
}

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const DIVIDER_REGEX = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_START_REGEX = /^\s*(`{3,}|~{3,})(.*)$/;
const THINKING_START_REGEX = /^\s*<(?:thinking|tg-thinking)>/i;
const THINKING_END_REGEX = /<\/(?:thinking|tg-thinking)>/i;
const DETAILS_START_REGEX = /^\s*<details(\s+open)?\s*>/i;
const DETAILS_END_REGEX = /<\/details>/i;
const SUMMARY_TAG_REGEX = /<summary>([\s\S]*?)<\/summary>/i;
const BLOCKQUOTE_REGEX = /^\s*>\s?(.*)$/;
const BULLET_ITEM_REGEX = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM_REGEX = /^\s*(\d+)\.\s+(.*)$/;
const CHECKBOX_PREFIX_REGEX = /^\[([ xX])\]\s+(.*)$/;

/**
 * Checks if line i followed by line i+1 begins a Markdown table.
 */
function isTableStarter(lines: readonly string[], i: number): boolean {
  if (i + 1 < lines.length && lines[i].includes("|")) {
    return parseDelimiterRow(lines[i + 1]) !== null;
  }
  return false;
}

/**
 * Checks if the line at index i starts a new non-paragraph block.
 */
function isBlockStarter(lines: readonly string[], i: number): boolean {
  const line = lines[i];
  return (
    HEADING_REGEX.test(line) ||
    DIVIDER_REGEX.test(line) ||
    FENCE_START_REGEX.test(line) ||
    THINKING_START_REGEX.test(line) ||
    DETAILS_START_REGEX.test(line) ||
    BLOCKQUOTE_REGEX.test(line) ||
    BULLET_ITEM_REGEX.test(line) ||
    ORDERED_ITEM_REGEX.test(line) ||
    isTableStarter(lines, i)
  );
}

/**
 * Tries to parse a fenced code block (```lang ... ``` or ~~~lang ... ~~~).
 */
function tryConsumeFence(
  lines: readonly string[],
  start: number
): { block: InputRichBlockPreformatted; nextIndex: number } | null {
  const line = lines[start];
  const match = FENCE_START_REGEX.exec(line);
  if (!match) {
    return null;
  }

  const fenceChar = match[1][0];
  const fenceLength = match[1].length;
  const rawLang = match[2].trim();
  const language = rawLang.length > 0 ? rawLang : undefined;

  const codeLines: string[] = [];
  let i = start + 1;
  let closed = false;

  const closeRegex = new RegExp(`^\\s*\\${fenceChar}{${fenceLength},}\\s*$`);

  while (i < lines.length) {
    const cur = lines[i];
    if (closeRegex.test(cur)) {
      closed = true;
      i++;
      break;
    }
    codeLines.push(cur);
    i++;
  }

  const block: InputRichBlockPreformatted = {
    type: "pre",
    text: codeLines.join("\n"),
    ...(language ? { language } : {}),
  };

  return { block, nextIndex: i };
}

/**
 * Tries to parse an AI thinking block (<thinking>...</thinking> or <tg-thinking>...</tg-thinking>).
 */
function tryConsumeThinking(
  lines: readonly string[],
  start: number
): { block: InputRichBlockThinking; nextIndex: number } | null {
  const line = lines[start];
  if (!THINKING_START_REGEX.test(line)) {
    return null;
  }

  // Check if opening and closing are on the same line
  const openMatch = THINKING_START_REGEX.exec(line);
  if (!openMatch) {
    return null;
  }

  const afterOpen = line.slice(openMatch[0].length);
  const closeMatchSameLine = THINKING_END_REGEX.exec(afterOpen);
  if (closeMatchSameLine) {
    const content = afterOpen.slice(0, closeMatchSameLine.index).trim();
    const block: InputRichBlockThinking = {
      type: "thinking",
      text: parseInlineRichText(content),
    };
    return { block, nextIndex: start + 1 };
  }

  // Multi-line thinking block
  const contentLines: string[] = [];
  if (afterOpen.trim().length > 0) {
    contentLines.push(afterOpen.trim());
  }

  let i = start + 1;
  while (i < lines.length) {
    const cur = lines[i];
    const closeMatch = THINKING_END_REGEX.exec(cur);
    if (closeMatch) {
      const beforeClose = cur.slice(0, closeMatch.index).trim();
      if (beforeClose.length > 0) {
        contentLines.push(beforeClose);
      }
      i++;
      break;
    }
    contentLines.push(cur);
    i++;
  }

  const block: InputRichBlockThinking = {
    type: "thinking",
    text: parseInlineRichText(contentLines.join("\n").trim()),
  };

  return { block, nextIndex: i };
}

/**
 * Tries to parse a horizontal divider (---, ***, ___).
 */
function tryConsumeDivider(
  lines: readonly string[],
  start: number
): { block: InputRichBlockDivider; nextIndex: number } | null {
  const line = lines[start];
  if (!DIVIDER_REGEX.test(line)) {
    return null;
  }
  const block: InputRichBlockDivider = {
    type: "divider",
  };
  return { block, nextIndex: start + 1 };
}

/**
 * Tries to parse a section heading (# Heading).
 */
function tryConsumeHeading(
  lines: readonly string[],
  start: number
): { block: InputRichBlockSectionHeading; nextIndex: number } | null {
  const line = lines[start];
  const match = HEADING_REGEX.exec(line);
  if (!match) {
    return null;
  }
  const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6;
  const content = match[2].trim();
  const block: InputRichBlockSectionHeading = {
    type: "heading",
    size: level,
    text: parseInlineRichText(content),
  };
  return { block, nextIndex: start + 1 };
}

/**
 * Tries to parse a GFM table block.
 */
function tryConsumeTable(
  lines: readonly string[],
  start: number,
  options?: RichParserOptions
): { block: InputRichBlockTable; nextIndex: number } | null {
  if (!isTableStarter(lines, start)) {
    return null;
  }

  const tableLines: string[] = [];
  let i = start;

  while (i < lines.length) {
    const cur = lines[i];
    if (!cur.includes("|") || cur.trim().length === 0) {
      break;
    }
    tableLines.push(cur);
    i++;
  }

  const table = parseMarkdownTable(tableLines.join("\n"), options?.tableOptions);
  if (!table) {
    return null;
  }

  return { block: table, nextIndex: i };
}

/**
 * Tries to parse a blockquote block (> ...).
 */
function tryConsumeBlockquote(
  lines: readonly string[],
  start: number,
  options?: RichParserOptions
): { block: InputRichBlockBlockQuotation; nextIndex: number } | null {
  const line = lines[start];
  if (!BLOCKQUOTE_REGEX.test(line)) {
    return null;
  }

  const innerLines: string[] = [];
  let i = start;

  while (i < lines.length) {
    const cur = lines[i];
    const match = BLOCKQUOTE_REGEX.exec(cur);
    if (!match) {
      break;
    }
    innerLines.push(match[1]);
    i++;
  }

  const innerBlocks = parseBlocks(innerLines, options);
  const block: InputRichBlockBlockQuotation = {
    type: "blockquote",
    blocks:
      innerBlocks.length > 0
        ? innerBlocks
        : [{ type: "paragraph", text: "" }],
  };

  return { block, nextIndex: i };
}

/**
 * Parses a single list line into an InputRichBlockListItem.
 */
function parseListItem(line: string): InputRichBlockListItem | null {
  const bulletMatch = BULLET_ITEM_REGEX.exec(line);
  const orderedMatch = bulletMatch ? null : ORDERED_ITEM_REGEX.exec(line);

  if (!bulletMatch && !orderedMatch) {
    return null;
  }

  const rawContent = bulletMatch ? bulletMatch[1] : orderedMatch![2];
  const item: InputRichBlockListItem = {
    blocks: [],
  };

  if (orderedMatch) {
    item.type = "1";
    item.value = parseInt(orderedMatch[1], 10);
  }

  const checkboxMatch = CHECKBOX_PREFIX_REGEX.exec(rawContent);
  let textContent = rawContent;
  if (checkboxMatch) {
    item.has_checkbox = true;
    if (checkboxMatch[1].toLowerCase() === "x") {
      item.is_checked = true;
    }
    textContent = checkboxMatch[2];
  }

  item.blocks = [
    {
      type: "paragraph",
      text: parseInlineRichText(textContent.trim()),
    },
  ];

  return item;
}

/**
 * Tries to parse a list block (bullet, ordered, or task list).
 */
function tryConsumeList(
  lines: readonly string[],
  start: number
): { block: InputRichBlockList; nextIndex: number } | null {
  const firstItem = parseListItem(lines[start]);
  if (!firstItem) {
    return null;
  }

  const items: InputRichBlockListItem[] = [firstItem];
  let i = start + 1;

  while (i < lines.length) {
    const cur = lines[i];
    if (cur.trim().length === 0) {
      break;
    }
    const item = parseListItem(cur);
    if (!item) {
      break;
    }
    items.push(item);
    i++;
  }

  const block: InputRichBlockList = {
    type: "list",
    items,
  };

  return { block, nextIndex: i };
}

/**
 * Tries to parse an expandable details block (<details>...</details>).
 */
function tryConsumeDetails(
  lines: readonly string[],
  start: number,
  options?: RichParserOptions
): { block: InputRichBlockDetails; nextIndex: number } | null {
  const line = lines[start];
  const startMatch = DETAILS_START_REGEX.exec(line);
  if (!startMatch) {
    return null;
  }

  const isOpen = Boolean(startMatch[1]);
  const collectedLines: string[] = [line.slice(startMatch[0].length)];
  let i = start + 1;

  while (i < lines.length) {
    const cur = lines[i];
    const endMatch = DETAILS_END_REGEX.exec(cur);
    if (endMatch) {
      const beforeEnd = cur.slice(0, endMatch.index);
      if (beforeEnd.trim().length > 0) {
        collectedLines.push(beforeEnd);
      }
      i++;
      break;
    }
    collectedLines.push(cur);
    i++;
  }

  const fullContent = collectedLines.join("\n");
  const summaryMatch = SUMMARY_TAG_REGEX.exec(fullContent);

  let summaryText = "Details";
  let bodyContent = fullContent;

  if (summaryMatch) {
    summaryText = summaryMatch[1].trim();
    bodyContent =
      fullContent.slice(0, summaryMatch.index) +
      fullContent.slice(summaryMatch.index + summaryMatch[0].length);
  }

  const bodyLines = bodyContent
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const innerBlocks = parseBlocks(bodyLines, options);

  const block: InputRichBlockDetails = {
    type: "details",
    summary: parseInlineRichText(summaryText),
    blocks: innerBlocks,
    ...(isOpen ? { is_open: true } : {}),
  };

  return { block, nextIndex: i };
}

/**
 * Consumes consecutive lines belonging to a plain paragraph.
 */
function consumeParagraph(
  lines: readonly string[],
  start: number
): { block: InputRichBlockParagraph; nextIndex: number } {
  const paragraphLines: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0 || (i > start && isBlockStarter(lines, i))) {
      break;
    }
    paragraphLines.push(line);
    i++;
  }

  const paragraphText = paragraphLines.join("\n");
  const block: InputRichBlockParagraph = {
    type: "paragraph",
    text: parseInlineRichText(paragraphText),
  };

  return { block, nextIndex: i };
}

/**
 * Parses markdown lines into an array of InputRichBlock objects.
 */
function parseBlocks(
  lines: readonly string[],
  options?: RichParserOptions
): InputRichBlock[] {
  const blocks: InputRichBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines between blocks
    if (line.trim().length === 0) {
      i++;
      continue;
    }

    const heading = tryConsumeHeading(lines, i);
    if (heading) {
      blocks.push(heading.block);
      i = heading.nextIndex;
      continue;
    }

    const fence = tryConsumeFence(lines, i);
    if (fence) {
      blocks.push(fence.block);
      i = fence.nextIndex;
      continue;
    }

    const thinking = tryConsumeThinking(lines, i);
    if (thinking) {
      blocks.push(thinking.block);
      i = thinking.nextIndex;
      continue;
    }

    const divider = tryConsumeDivider(lines, i);
    if (divider) {
      blocks.push(divider.block);
      i = divider.nextIndex;
      continue;
    }

    const table = tryConsumeTable(lines, i, options);
    if (table) {
      blocks.push(table.block);
      i = table.nextIndex;
      continue;
    }

    const blockquote = tryConsumeBlockquote(lines, i, options);
    if (blockquote) {
      blocks.push(blockquote.block);
      i = blockquote.nextIndex;
      continue;
    }

    const list = tryConsumeList(lines, i);
    if (list) {
      blocks.push(list.block);
      i = list.nextIndex;
      continue;
    }

    const details = tryConsumeDetails(lines, i, options);
    if (details) {
      blocks.push(details.block);
      i = details.nextIndex;
      continue;
    }

    const para = consumeParagraph(lines, i);
    blocks.push(para.block);
    i = para.nextIndex;
  }

  return blocks;
}

/**
 * Converts a markdown document into an InputRichMessage with structured blocks.
 */
export function parseMarkdownToRichMessage(
  markdown: string,
  options?: RichParserOptions
): InputRichMessage & { blocks: InputRichBlock[] } {
  if (!markdown || markdown.trim().length === 0) {
    return { blocks: [] };
  }

  const lines = markdown.split(/\r?\n/);
  const blocks = parseBlocks(lines, options);

  return { blocks };
}
