# Codebase Signatures & Symbol Index

Quick-reference catalog of function and method signatures, arguments, and return types.

## [`src/bot.ts`](../src/bot.ts)

### Classes
- **`class CreateBotOptions`** (L11)
- **`class ActiveSession`** (L21)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `createBot` | `createBot()` | L26 | 0 |
| `attachThrottlerSession` | `attachThrottlerSession()` | L124 | 0 |
| `handleUserPrompt` | `handleUserPrompt()` | L181 | 0 |

## [`src/config.ts`](../src/config.ts)

### Classes
- **`class Config`** (L95)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `loadConfig` | `loadConfig()` | L107 | 0 |
| `getConfig` | `getConfig()` | L137 | 0 |
| `resetConfig` | `resetConfig()` | L144 | 0 |

## [`src/index.ts`](../src/index.ts)

### Classes
- **`class Logger`** (L10)
- **`class StartAppOptions`** (L16)
- **`class AppInstance`** (L27)
- **`class SignalBinding`** (L49)
- **`class PollingResult`** (L87)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `ensureDirectories` | `ensureDirectories()` | L35 | 0 |
| `createDefaultPiClient` | `createDefaultPiClient()` | L40 | 0 |
| `attachLifecycleHandlers` | `attachLifecycleHandlers()` | L53 | 0 |
| `startBotPolling` | `startBotPolling()` | L91 | 0 |
| `startApp` | `startApp()` | L159 | 0 |
| `main` | `main()` | L251 | 0 |
| `isDirectExecution` | `isDirectExecution()` | L266 | 0 |

## [`src/pi/client.ts`](../src/pi/client.ts)

### Classes
- **`class PiClientOptions`** (L22)
- **`class PromptOptions`** (L45)
- **`class PendingRequest`** (L50)
- **`class PiClient`** (L63)
- **`class get`** (L106)
- **`class async`** (L205)

## [`src/pi/framing.ts`](../src/pi/framing.ts)

### Classes
- **`class ProtocolFramerOptions`** (L4)
- **`class ProtocolFramer`** (L46)
- **`class feed`** (L62)
- **`class push`** (L86)
- **`class flush`** (L94)
- **`class reset`** (L119)
- **`class getBuffer`** (L127)
- **`class attach`** (L134)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `sanitizeLine` | `sanitizeLine()` | L16 | 0 |
| `serializeCommand` | `serializeCommand()` | L31 | 0 |

## [`src/pi/types.ts`](../src/pi/types.ts)

### Classes
- **`class TextContentPart`** (L9)
- **`class ImageContentPart`** (L14)
- **`class PromptCommand`** (L22)
- **`class AbortCommand`** (L30)
- **`class GetStateCommand`** (L35)
- **`class TextDelta`** (L46)
- **`class ThinkingDelta`** (L52)
- **`class ToolCallDelta`** (L58)
- **`class AgentStartEvent`** (L71)
- **`class TurnStartEvent`** (L75)
- **`class MessageStartEvent`** (L79)
- **`class MessageUsage`** (L84)
- **`class MessageUpdateEvent`** (L91)
- **`class ToolCallStartEvent`** (L97)
- **`class ToolCallEndEvent`** (L106)
- **`class TurnEndEvent`** (L115)
- **`class AgentEndEvent`** (L121)
- **`class AgentSettledEvent`** (L126)
- **`class PiErrorEvent`** (L131)
- **`class PiWarningEvent`** (L138)
- **`class PiResponseEvent`** (L144)
- **`class PiClientEvents`** (L172)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `isRecord` | `isRecord()` | L185 | 0 |
| `isPromptCommand` | `isPromptCommand()` | L189 | 0 |
| `isAbortCommand` | `isAbortCommand()` | L198 | 0 |
| `isGetStateCommand` | `isGetStateCommand()` | L203 | 0 |
| `isRpcCommand` | `isRpcCommand()` | L214 | 0 |
| `isAgentStartEvent` | `isAgentStartEvent()` | L222 | 0 |
| `isTurnStartEvent` | `isTurnStartEvent()` | L226 | 0 |
| `isMessageStartEvent` | `isMessageStartEvent()` | L230 | 0 |
| `isMessageUpdateEvent` | `isMessageUpdateEvent()` | L234 | 0 |
| `isToolCallStartEvent` | `isToolCallStartEvent()` | L238 | 0 |
| `isToolCallEndEvent` | `isToolCallEndEvent()` | L242 | 0 |
| `isTurnEndEvent` | `isTurnEndEvent()` | L246 | 0 |
| `isAgentEndEvent` | `isAgentEndEvent()` | L250 | 0 |
| `isAgentSettledEvent` | `isAgentSettledEvent()` | L254 | 0 |
| `isErrorEvent` | `isErrorEvent()` | L258 | 0 |
| `isWarningEvent` | `isWarningEvent()` | L262 | 0 |
| `isResponseEvent` | `isResponseEvent()` | L266 | 0 |
| `isRpcEvent` | `isRpcEvent()` | L285 | 0 |
| `extractTextDelta` | `extractTextDelta()` | L296 | 0 |

## [`src/telegram/markdown.ts`](../src/telegram/markdown.ts)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `toggleMarker` | `toggleMarker()` | L30 | 0 |
| `isIdentifierUnderscore` | `isIdentifierUnderscore()` | L42 | 0 |
| `isArithmeticAsterisk` | `isArithmeticAsterisk()` | L51 | 0 |
| `processCodeFenceLine` | `processCodeFenceLine()` | L61 | 0 |
| `isCodeBlockOpen` | `isCodeBlockOpen()` | L89 | 0 |
| `balanceInlineFormatting` | `balanceInlineFormatting()` | L113 | 0 |
| `balanceMarkdown` | `balanceMarkdown()` | L214 | 0 |
| `formatTelegramMarkdown` | `formatTelegramMarkdown()` | L230 | 0 |
| `stripMarkdown` | `stripMarkdown()` | L239 | 0 |
| `formatStreamingChunk` | `formatStreamingChunk()` | L298 | 0 |

## [`src/telegram/media.ts`](../src/telegram/media.ts)

### Classes
- **`class PhotoSizeLike`** (L8)
- **`class TelegramFileLike`** (L16)
- **`class BotApiLike`** (L23)
- **`class DownloadedPhoto`** (L30)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `getLargestPhotoFileId` | `getLargestPhotoFileId()` | L41 | 0 |
| `getMimeTypeFromPath` | `getMimeTypeFromPath()` | L83 | 0 |
| `sanitizeToken` | `sanitizeToken()` | L100 | 0 |
| `downloadTelegramPhotoAsBase64` | `downloadTelegramPhotoAsBase64()` | L123 | 0 |

## [`src/telegram/rich-parser.ts`](../src/telegram/rich-parser.ts)

### Classes
- **`class RichParserOptions`** (L27)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `isTableStarter` | `isTableStarter()` | L47 | 0 |
| `isBlockStarter` | `isBlockStarter()` | L57 | 0 |
| `tryConsumeFence` | `tryConsumeFence()` | L75 | 0 |
| `tryConsumeThinking` | `tryConsumeThinking()` | L119 | 0 |
| `tryConsumeDivider` | `tryConsumeDivider()` | L178 | 0 |
| `tryConsumeHeading` | `tryConsumeHeading()` | L195 | 0 |
| `tryConsumeTable` | `tryConsumeTable()` | L217 | 0 |
| `tryConsumeBlockquote` | `tryConsumeBlockquote()` | L249 | 0 |
| `parseListItem` | `parseListItem()` | L287 | 0 |
| `tryConsumeList` | `tryConsumeList()` | L328 | 0 |
| `tryConsumeDetails` | `tryConsumeDetails()` | L364 | 0 |
| `consumeParagraph` | `consumeParagraph()` | L427 | 0 |
| `parseBlocks` | `parseBlocks()` | L455 | 0 |
| `parseMarkdownToRichMessage` | `parseMarkdownToRichMessage()` | L538 | 0 |

## [`src/telegram/rich-table.ts`](../src/telegram/rich-table.ts)

### Classes
- **`class TableOptions`** (L16)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `splitRowIntoCells` | `splitRowIntoCells()` | L30 | 0 |
| `parseDelimiterRow` | `parseDelimiterRow()` | L81 | 0 |
| `buildCell` | `buildCell()` | L111 | 0 |
| `buildRow` | `buildRow()` | L131 | 0 |
| `applyTableOptions` | `applyTableOptions()` | L151 | 0 |
| `isMarkdownTable` | `isMarkdownTable()` | L173 | 0 |
| `parseMarkdownTable` | `parseMarkdownTable()` | L181 | 0 |

## [`src/telegram/rich-text.ts`](../src/telegram/rich-text.ts)

### Classes
- **`class DelimMatch`** (L54)
- **`class DelimDef`** (L93)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `maskEscapes` | `maskEscapes()` | L35 | 0 |
| `unmaskEscapes` | `unmaskEscapes()` | L46 | 0 |
| `matchDelim` | `matchDelim()` | L63 | 0 |
| `tryMatchDelim` | `tryMatchDelim()` | L118 | 0 |
| `parseCode` | `parseCode()` | L134 | 0 |
| `parseMath` | `parseMath()` | L150 | 0 |
| `parseHtmlUnderline` | `parseHtmlUnderline()` | L170 | 0 |
| `parseLink` | `parseLink()` | L186 | 0 |
| `pushStyledEntity` | `pushStyledEntity()` | L205 | 0 |
| `parseNodes` | `parseNodes()` | L218 | 0 |
| `flushText` | `flushText()` | L223 | 0 |
| `parseInlineRichText` | `parseInlineRichText()` | L308 | 0 |

## [`src/telegram/throttler.ts`](../src/telegram/throttler.ts)

### Classes
- **`class TelegramApiLike`** (L5)
- **`class StreamThrottlerOptions`** (L34)
- **`class StreamThrottler`** (L44)
- **`class get`** (L106)
- **`class feed`** (L110)
- **`class setToolStatus`** (L118)
- **`class async`** (L370)

## [`tests/bot.test.ts`](../tests/bot.test.ts)

### Classes
- **`class MockApiCall`** (L53)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `createTestConfig` | `createTestConfig()` | L7 | 0 |
| `createMockPiClient` | `createMockPiClient()` | L23 | 0 |
| `attachMockApi` | `attachMockApi()` | L58 | 0 |
| `makeUpdate` | `makeUpdate()` | L118 | 0 |

## [`tests/index.test.ts`](../tests/index.test.ts)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `createTestConfig` | `createTestConfig()` | L9 | 0 |
| `createMockPiClient` | `createMockPiClient()` | L24 | 0 |
| `createMockBot` | `createMockBot()` | L40 | 0 |

## [`tests/integration.test.ts`](../tests/integration.test.ts)

### Classes
- **`class MockChildProcess`** (L16)
- **`class MockApiCall`** (L94)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `createMockChildProcess` | `createMockChildProcess()` | L29 | 0 |
| `createTestConfig` | `createTestConfig()` | L79 | 0 |
| `attachMockTelegramApi` | `attachMockTelegramApi()` | L99 | 0 |
| `makeUpdate` | `makeUpdate()` | L167 | 0 |

## [`tests/pi-client.test.ts`](../tests/pi-client.test.ts)

### Classes
- **`class MockChildProcess`** (L7)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `createMockChildProcess` | `createMockChildProcess()` | L18 | 0 |

## [`tests/rich-parser.test.ts`](../tests/rich-parser.test.ts)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `run` | `run()` | L520 | 0 |

## [`tests/throttler.test.ts`](../tests/throttler.test.ts)

### Functions & Methods
| Symbol | Signature | Line | Callers |
| :--- | :--- | :--- | :--- |
| `createMockApi` | `createMockApi()` | L4 | 0 |
| `createRichMockApi` | `createRichMockApi()` | L19 | 0 |
