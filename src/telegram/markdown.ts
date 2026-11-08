import telegramifyMarkdown from "telegramify-markdown";

const ESCAPE_MAP: Readonly<Record<string, string>> = {
  "\\": "\uE000",
  "`": "\uE001",
  "*": "\uE002",
  "_": "\uE003",
  "{": "\uE004",
  "}": "\uE005",
  "[": "\uE006",
  "]": "\uE007",
  "(": "\uE008",
  ")": "\uE009",
  "#": "\uE00A",
  "+": "\uE00B",
  "-": "\uE00C",
  ".": "\uE00D",
  "!": "\uE00E",
  "~": "\uE00F",
  "|": "\uE010",
};

const UNESCAPE_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ESCAPE_MAP).map(([k, v]) => [v, k])
);

/**
 * Toggles a formatting marker in the stack: pops if previously open, pushes otherwise.
 */
function toggleMarker(stack: string[], marker: string): void {
  const idx = stack.lastIndexOf(marker);
  if (idx !== -1) {
    stack.splice(idx, 1);
  } else {
    stack.push(marker);
  }
}

/**
 * Checks if an underscore at index i is inside an identifier (e.g. user_id).
 */
function isIdentifierUnderscore(text: string, i: number): boolean {
  const prev = i > 0 ? text[i - 1] : " ";
  const next = i + 1 < text.length ? text[i + 1] : "";
  return /\w/.test(prev) && /\w/.test(next);
}

/**
 * Checks if an asterisk at index i is space-isolated (arithmetic multiplication).
 */
function isArithmeticAsterisk(text: string, i: number): boolean {
  const prev = i > 0 ? text[i - 1] : " ";
  const next = i + 1 < text.length ? text[i + 1] : "";
  return /\s/.test(prev) && /\s/.test(next);
}

/**
 * Checks if a fenced code block delimiter starts at index i on a new line.
 * Updates inCodeFence state and returns characters consumed (0 if not a fence).
 */
function processCodeFenceLine(
  text: string,
  i: number,
  state: { inCodeFence: boolean }
): number {
  const rest = text.slice(i);
  if (!/^[ \t]*```/.test(rest)) {
    return 0;
  }

  const lineEnd = rest.indexOf("\n");
  const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
  const trimmed = line.trimStart();

  if (!state.inCodeFence) {
    if (!trimmed.slice(3).includes("```")) {
      state.inCodeFence = true;
    }
  } else {
    state.inCodeFence = false;
  }

  return line.length + (lineEnd === -1 ? 0 : 1);
}

/**
 * Checks if a fenced code block (```) is currently open at the end of the text.
 */
function isCodeBlockOpen(text: string): boolean {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inCodeBlock) {
      if (trimmed.startsWith("```") && !trimmed.slice(3).includes("```")) {
        inCodeBlock = true;
      }
    } else {
      if (trimmed.startsWith("```")) {
        inCodeBlock = false;
      }
    }
  }

  return inCodeBlock;
}

/**
 * Balances inline formatting markers (*, _, **, ||, ~, ~~, `).
 * Ignores content inside code blocks or inline code.
 */
function balanceInlineFormatting(text: string): string {
  const stack: string[] = [];
  const fenceState = { inCodeFence: false };
  let inInlineCode = false;
  let i = 0;

  while (i < text.length) {
    // Check for code fences at line starts
    const isLineStart = i === 0 || text[i - 1] === "\n";
    if (isLineStart) {
      const consumed = processCodeFenceLine(text, i, fenceState);
      if (consumed > 0) {
        i += consumed;
        continue;
      }
    }

    if (fenceState.inCodeFence) {
      i++;
      continue;
    }

    const ch = text[i];

    // Escape character \
    if (ch === "\\") {
      i += 2;
      continue;
    }

    // Inside inline code, only unescaped backtick closes it
    if (inInlineCode) {
      if (ch === "`") {
        inInlineCode = false;
      }
      i++;
      continue;
    }

    // Inline code opening
    if (ch === "`") {
      inInlineCode = true;
      i++;
      continue;
    }

    // Two-character markers: **, ||, ~~
    const twoChars = text.slice(i, i + 2);
    if (twoChars === "**" || twoChars === "||" || twoChars === "~~") {
      toggleMarker(stack, twoChars);
      i += 2;
      continue;
    }

    // Single-character markers: *, _, ~
    if (ch === "*" || ch === "_" || ch === "~") {
      if (ch === "_" && isIdentifierUnderscore(text, i)) {
        i++;
        continue;
      }

      if (ch === "*" && isArithmeticAsterisk(text, i)) {
        i++;
        continue;
      }

      const next = i + 1 < text.length ? text[i + 1] : "";
      const idx = stack.lastIndexOf(ch);
      if (idx !== -1) {
        stack.splice(idx, 1);
      } else if (next === "" || !/\s/.test(next)) {
        stack.push(ch);
      }
      i++;
      continue;
    }

    i++;
  }

  let suffix = "";
  if (inInlineCode) {
    suffix += "`";
  }

  while (stack.length > 0) {
    suffix += stack.pop();
  }

  return text + suffix;
}

/**
 * Dynamically inspects open formatting markers and balances them for streaming chunks:
 * - Fenced code blocks (```)
 * - Inline code (`)
 * - Bold (**)
 * - Italic (* or _)
 * - Spoilers (||)
 * - Strikethrough (~ or ~~)
 */
export function balanceMarkdown(text: string): string {
  if (!text) {
    return text;
  }

  if (isCodeBlockOpen(text)) {
    return text.endsWith("\n") ? `${text}\`\`\`\n` : `${text}\n\`\`\`\n`;
  }

  return balanceInlineFormatting(text);
}

/**
 * Formats Markdown into Telegram-compatible MarkdownV2 using telegramify-markdown.
 * If isPartial is true, balances open formatting tags before converting.
 */
export function formatTelegramMarkdown(text: string, isPartial = false): string {
  const normalized = isPartial ? balanceMarkdown(text) : text;
  return telegramifyMarkdown(normalized, "escape");
}

/**
 * Fallback plaintext stripper that safely strips markdown formatting tags
 * if Telegram rejects entity parsing.
 */
export function stripMarkdown(text: string): string {
  if (!text) {
    return text;
  }

  const originallyEndedWithNewline = text.endsWith("\n");

  // First balance open markers so partial syntax closes neatly
  let res = balanceMarkdown(text);

  // Protect escaped characters from formatting regexes
  res = res.replace(/\\([\\`*_{}[\]()#+\-.!~|])/g, (_, ch) => ESCAPE_MAP[ch] ?? ch);

  // Strip code block fence lines
  res = res
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("```"))
    .join("\n");

  // Strip markdown headers (# Title -> Title)
  res = res.replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, "$1");

  // Strip blockquotes (> Quote -> Quote)
  res = res.replace(/^[ \t]*>[ \t]?(.*)$/gm, "$1");

  // Links: [Text](URL) -> Text (URL)
  res = res.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Spoilers: ||text|| -> text
  res = res.replace(/\|\|(.*?)\|\|/g, "$1");

  // Bold & Italic
  res = res.replace(/\*\*\*(.*?)\*\*\*/g, "$1");
  res = res.replace(/\*\*(.*?)\*\*/g, "$1");
  res = res.replace(/\*([^*\n]+)\*/g, "$1");
  res = res.replace(/___(.*?)___/g, "$1");
  res = res.replace(/__(.*?)__/g, "$1");
  res = res.replace(/_([^_\n]+)_/g, "$1");

  // Inline code: `code` -> code
  res = res.replace(/`([^`\n]+)`/g, "$1");

  // Strikethrough: ~~text~~, ~text~
  res = res.replace(/~~(.*?)~~/g, "$1");
  res = res.replace(/~([^~\n]+)~/g, "$1");

  // Restore protected escaped characters
  res = res.replace(/[\uE000-\uE010]/g, (ch) => UNESCAPE_MAP[ch] ?? ch);

  if (!originallyEndedWithNewline && res.endsWith("\n")) {
    res = res.replace(/\n+$/, "");
  }

  return res;
}

/**
 * Formats a streaming chunk into both MarkdownV2 and safe plain-text fallback.
 */
export function formatStreamingChunk(text: string): { markdown: string; plain: string } {
  return {
    markdown: formatTelegramMarkdown(text, true),
    plain: stripMarkdown(text),
  };
}
