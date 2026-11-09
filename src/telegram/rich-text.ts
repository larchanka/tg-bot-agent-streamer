/**
 * Inline RichText parser for Telegram Bot API 10.1+.
 * Converts markdown inline styling into structured Telegram RichText representations.
 */

import type {
  RichText,
  RichTextCode,
  RichTextUrl,
  RichTextMathematicalExpression,
  RichTextEntity,
} from "./rich-types.js";

const ESCAPE_MAP: Readonly<Record<string, string>> = {
  "\\\\": "\uE000",
  "\\`": "\uE001",
  "\\*": "\uE002",
  "\\_": "\uE003",
  "\\[": "\uE006",
  "\\]": "\uE007",
  "\\(": "\uE008",
  "\\)": "\uE009",
  "\\~": "\uE00F",
  "\\|": "\uE010",
  "\\$": "\uE011",
};

const UNESCAPE_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ESCAPE_MAP).map(([k, v]) => [v, k.slice(1)])
);

/**
 * Replaces backslash-escaped characters with private unicode markers to avoid false token detection.
 */
function maskEscapes(text: string): string {
  let masked = text;
  for (const [seq, char] of Object.entries(ESCAPE_MAP)) {
    masked = masked.replaceAll(seq, char);
  }
  return masked;
}

/**
 * Restores private unicode markers back to their literal unescaped characters.
 */
function unmaskEscapes(text: string): string {
  let unmasked = text;
  for (const [char, original] of Object.entries(UNESCAPE_MAP)) {
    unmasked = unmasked.replaceAll(char, original);
  }
  return unmasked;
}

interface DelimMatch {
  readonly inner: string;
  readonly end: number;
}

/**
 * Finds a matching closing delimiter run for char starting after start + minLength.
 * Correctly accounts for compound/nested delimiter runs (e.g. *** ending inner * and outer **).
 */
function matchDelim(
  text: string,
  start: number,
  char: string,
  minLength: number
): DelimMatch | null {
  let i = start + minLength;
  while (i < text.length) {
    if (text[i] === char) {
      let run = 0;
      while (i + run < text.length && text[i + run] === char) {
        run++;
      }
      if (run >= minLength) {
        return {
          inner: text.slice(start + minLength, i + (run - minLength)),
          end: i + run,
        };
      }
      i += run;
    } else {
      i++;
    }
  }
  return null;
}

/**
 * Delimiter definitions ordered by precedence (e.g. multi-character tokens before single).
 */
interface DelimDef {
  readonly prefix: string;
  readonly char: string;
  readonly minLength: number;
  readonly type: "bold" | "italic" | "underline" | "strikethrough" | "spoiler";
  readonly requireNonEmpty?: boolean;
}

const DELIM_DEFS: readonly DelimDef[] = [
  { prefix: "||", char: "|", minLength: 2, type: "spoiler" },
  { prefix: "**", char: "*", minLength: 2, type: "bold" },
  { prefix: "__", char: "_", minLength: 2, type: "underline" },
  { prefix: "~~", char: "~", minLength: 2, type: "strikethrough" },
  { prefix: "~", char: "~", minLength: 1, type: "strikethrough", requireNonEmpty: true },
  { prefix: "*", char: "*", minLength: 1, type: "italic", requireNonEmpty: true },
  { prefix: "_", char: "_", minLength: 1, type: "italic", requireNonEmpty: true },
];

type DelimResult =
  | { readonly matched: true; readonly type: DelimDef["type"]; readonly inner: string; readonly end: number }
  | { readonly matched: false; readonly prefix: string };

/**
 * Checks if a known formatting delimiter starts at index i and resolves its matching span.
 */
function tryMatchDelim(text: string, i: number): DelimResult | null {
  for (const def of DELIM_DEFS) {
    if (text.startsWith(def.prefix, i)) {
      const m = matchDelim(text, i, def.char, def.minLength);
      if (m && (!def.requireNonEmpty || m.inner.length > 0)) {
        return { matched: true, type: def.type, inner: m.inner, end: m.end };
      }
      return { matched: false, prefix: def.prefix };
    }
  }
  return null;
}

/**
 * Attempts to parse an inline backtick code snippet at index i.
 */
function parseCode(
  text: string,
  i: number
): { codeText: string; nextIndex: number } | null {
  if (text[i] !== "`") return null;
  const closeIdx = text.indexOf("`", i + 1);
  if (closeIdx === -1) return null;
  return {
    codeText: unmaskEscapes(text.slice(i + 1, closeIdx)),
    nextIndex: closeIdx + 1,
  };
}

/**
 * Attempts to parse an inline LaTeX math expression ($...$) at index i.
 */
function parseMath(
  text: string,
  i: number
): { expr: string; nextIndex: number } | null {
  if (text[i] !== "$") return null;
  const closeIdx = text.indexOf("$", i + 1);
  if (closeIdx === -1 || closeIdx <= i + 1) return null;
  const expr = text.slice(i + 1, closeIdx);
  if (expr.startsWith(" ") || expr.endsWith(" ") || expr.includes("\n")) {
    return null;
  }
  return {
    expr: unmaskEscapes(expr),
    nextIndex: closeIdx + 1,
  };
}

/**
 * Attempts to parse an HTML <u>...</u> underline element at index i.
 */
function parseHtmlUnderline(
  text: string,
  i: number
): { inner: string; nextIndex: number } | null {
  if (!text.startsWith("<u>", i)) return null;
  const closeIdx = text.indexOf("</u>", i + 3);
  if (closeIdx === -1) return null;
  return {
    inner: text.slice(i + 3, closeIdx),
    nextIndex: closeIdx + 4,
  };
}

/**
 * Attempts to parse an inline Markdown link [label](url) at index i.
 */
function parseLink(
  text: string,
  i: number
): { label: string; url: string; nextIndex: number } | null {
  if (text[i] !== "[") return null;
  const closeBracket = text.indexOf("]", i + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== "(") return null;
  const closeParen = text.indexOf(")", closeBracket + 2);
  if (closeParen === -1) return null;
  return {
    label: text.slice(i + 1, closeBracket),
    url: unmaskEscapes(text.slice(closeBracket + 2, closeParen)),
    nextIndex: closeParen + 1,
  };
}

/**
 * Helper to wrap and push a styled entity node if inner text is non-empty.
 */
function pushStyledEntity(
  nodes: (string | RichTextEntity)[],
  type: DelimDef["type"],
  inner: string
): void {
  const parsedInner = parseInlineRichText(inner);
  if (parsedInner === "") return;
  nodes.push({ type, text: parsedInner } as RichTextEntity);
}

/**
 * Scans text and extracts discrete rich text nodes sequentially.
 */
function parseNodes(text: string): (string | RichTextEntity)[] {
  const nodes: (string | RichTextEntity)[] = [];
  let i = 0;
  let textBuf = "";

  function flushText(): void {
    if (textBuf.length > 0) {
      const unmasked = unmaskEscapes(textBuf);
      if (unmasked.length > 0) {
        nodes.push(unmasked);
      }
      textBuf = "";
    }
  }

  while (i < text.length) {
    // 1. Inline code: `...`
    const codeMatch = parseCode(text, i);
    if (codeMatch) {
      flushText();
      const codeEntity: RichTextCode = { type: "code", text: codeMatch.codeText };
      nodes.push(codeEntity);
      i = codeMatch.nextIndex;
      continue;
    }

    // 2. Inline math: $...$
    const mathMatch = parseMath(text, i);
    if (mathMatch) {
      flushText();
      const mathEntity: RichTextMathematicalExpression = {
        type: "mathematical_expression",
        expression: mathMatch.expr,
      };
      nodes.push(mathEntity);
      i = mathMatch.nextIndex;
      continue;
    }

    // 3. HTML <u>...</u>
    const uMatch = parseHtmlUnderline(text, i);
    if (uMatch) {
      flushText();
      pushStyledEntity(nodes, "underline", uMatch.inner);
      i = uMatch.nextIndex;
      continue;
    }

    // 4. Link: [label](url)
    const linkMatch = parseLink(text, i);
    if (linkMatch) {
      flushText();
      const urlEntity: RichTextUrl = {
        type: "url",
        text: parseInlineRichText(linkMatch.label),
        url: linkMatch.url,
      };
      nodes.push(urlEntity);
      i = linkMatch.nextIndex;
      continue;
    }

    // 5. Delimiter-based formatting (bold, italic, underline, strikethrough, spoiler)
    const delimMatch = tryMatchDelim(text, i);
    if (delimMatch) {
      if (delimMatch.matched) {
        flushText();
        pushStyledEntity(nodes, delimMatch.type, delimMatch.inner);
        i = delimMatch.end;
      } else {
        textBuf += delimMatch.prefix;
        i += delimMatch.prefix.length;
      }
      continue;
    }

    // Default: regular text character
    textBuf += text[i];
    i++;
  }

  flushText();
  return nodes;
}

/**
 * Parses Markdown inline formatting into structured Telegram RichText representations.
 * Handles bold, italic, code, underline, strikethrough, spoiler, links, and LaTeX math.
 * Safely tolerates unclosed tokens in streaming chunks.
 */
export function parseInlineRichText(text: string): RichText {
  if (!text) return "";
  const masked = maskEscapes(text);
  const nodes = parseNodes(masked);
  if (nodes.length === 0) return "";
  if (nodes.length === 1) return nodes[0];
  return nodes;
}

/**
 * Alias of parseInlineRichText for backwards and shorthand compatibility.
 */
export const parseRichText = parseInlineRichText;
