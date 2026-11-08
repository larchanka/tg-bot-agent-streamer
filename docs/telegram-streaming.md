# Telegram Streaming & Rich Markdown Handling

This document explains the technical challenges and solutions when streaming LLM responses with rich formatting to Telegram.

---

## 1. Telegram API Constraints

1. **Flood Limits**: Telegram limits bots to approximately 1 message edit per second per chat. Exceeding this triggers HTTP `429 Too Many Requests (Retry-After: N)`.
2. **Strict Entity Parsing**: Telegram's `MarkdownV2` parser is strict. An unclosed formatting marker (such as an incomplete code block ` ``` `, an odd number of asterisks, or an unescaped special character) results in `Bad Request: can't parse entities`.
3. **Message Length Limit**: A Telegram message cannot exceed 4096 UTF-8 characters.

---

## 2. Streaming Throttler Implementation

To satisfy Telegram's 1-second rate limit while maintaining a smooth visual experience for the user:

- **Token Accumulator**: Tokens arriving from `text_delta` are appended to an in-memory buffer.
- **Throttling Interval**: An interval timer checks for new tokens every 1000ms.
- **Dirty Flag**: If new tokens arrived since the last edit, an `editMessageText` call is dispatched.
- **Typing Indicator**: A background loop executes `sendChatAction(chatId, "typing")` every 4000ms until the agent settles.

---

## 3. Resolving the "Partial Markdown" Problem

During live streaming, text is cut off mid-sentence or mid-block:

```markdown
Here is the code:
```typescript
function calculate(
```

Sending this directly to Telegram with `parse_mode: "MarkdownV2"` immediately fails because the code block has no closing fence.

### Solution: Dynamic Tag Balancer

Before each intermediate edit:
1. Count open and closed code fences (```` ``` ````). If odd, append `\n```\n`.
2. Count unescaped inline code markers (`` ` ``). If odd, append `` ` ``.
3. Count unescaped bold (`**`), italic (`*`), spoiler (`||`), and strikethrough (`~`) markers. Append corresponding closing delimiters.
4. Convert through `telegramify-markdown` to ensure standard symbols outside code blocks are properly escaped for Telegram MarkdownV2.

### Resilient Fallback

If an intermediate edit still triggers a parse failure:
```typescript
try {
  await bot.api.editMessageText(chatId, messageId, formattedText, {
    parse_mode: "MarkdownV2",
  });
} catch (error: any) {
  if (error.message?.includes("can't parse entities")) {
    // Fall back to clean plain text for this frame
    await bot.api.editMessageText(chatId, messageId, rawPlainText);
  } else if (!error.message?.includes("message is not modified")) {
    throw error;
  }
}
```

---

## 4. Message Splitting (4096-Character Limit)

When the accumulated response approaches 4000 characters:
1. Finalize the current message (remove any transient status badges, apply full Markdown).
2. Send a new message to the chat (`ctx.reply("...")`).
3. Point subsequent streaming edits to the new `message_id`.
4. Continue streaming seamlessly until the agent completes.
