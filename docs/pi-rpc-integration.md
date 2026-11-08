# Pi AI-Agent RPC Protocol Integration

This document describes how the bot integrates with `@earendil-works/pi-coding-agent` in RPC mode (`pi --mode rpc`).

---

## 1. Process Invocation

The bot launches the `pi` CLI as a child process using Node's `child_process.spawn`:

```bash
pi --mode rpc --session-dir <PI_SESSION_DIR> [--model <PI_MODEL>]
```

- **Working Directory (`cwd`)**: Set to `PI_WORKSPACE_DIR` so that tools (`bash`, `read`, `write`, `edit`) operate in the target codebase.
- **Pipes**:
  - `stdin`: `'pipe'` for writing JSONL commands.
  - `stdout`: `'pipe'` for receiving JSONL events and responses.
  - `stderr`: Inherited or logged to diagnostics (contains CLI logs, not protocol records).

---

## 2. Framing Requirements

Pi uses strict JSONL framing:
- Every record is a single JSON object terminated by `\n` (LF).
- An optional preceding carriage return `\r` may be present and must be stripped.
- Stdout records must only be split on `\n`.

> [!WARNING]
> Do not use Node.js `readline` to parse `stdout`. Node's `readline` splits on `U+2028` (Line Separator) and `U+2029` (Paragraph Separator). These code points are legal inside JSON string literals and splitting on them corrupts JSON documents.

---

## 3. Supported Stdin Commands

### 3.1 Prompting (Idle)
When the agent is not streaming, prompts are submitted with:
```json
{
  "id": "req-1",
  "type": "prompt",
  "message": "Write a script to parse logs"
}
```

With image attachments:
```json
{
  "id": "req-2",
  "type": "prompt",
  "message": "Explain this architecture diagram",
  "images": [
    {
      "type": "image",
      "data": "<base64_encoded_jpeg>",
      "mimeType": "image/jpeg"
    }
  ]
}
```

### 3.2 In-Flight Steering
When the agent is already running and the user sends another message:
```json
{
  "id": "req-3",
  "type": "prompt",
  "message": "Focus only on error logs",
  "streamingBehavior": "steer"
}
```
*Behavior*: Delivers the steering prompt immediately after the current assistant step completes its active tool call, before the next LLM inference step.

### 3.3 Aborting Current Work
To stop an active run (triggered by `/stop` or `/abort`):
```json
{
  "id": "req-4",
  "type": "abort"
}
```

### 3.4 State Inspection
To query session ID and current model:
```json
{
  "id": "req-5",
  "type": "get_state"
}
```

---

## 4. Key Stdout Events

| Event Type | Fields | Meaning & Action |
|---|---|---|
| `agent_start` | None | Low-level agent run begins. Bot initiates typing action. |
| `turn_start` | None | New assistant turn begins. |
| `message_update` | `assistantMessageEvent` | Assistant delta event. Filter for `text_delta` and buffer chunk. |
| `toolcall_start` | `toolName`, `id` | Tool execution begins. Update Telegram live status badge. |
| `toolcall_end` | `toolCall` | Tool execution ends. Clear tool badge. |
| `turn_end` | `message`, `toolResults` | Turn complete. |
| `agent_end` | `willRetry` | Run loop finished. |
| `agent_settled` | `aborted` | Agent has finished all automatic actions. Finalize message. |

### Example `message_update` Event:
```json
{
  "type": "message_update",
  "usage": { "totalTokens": 142 },
  "assistantMessageEvent": {
    "type": "text_delta",
    "contentIndex": 0,
    "delta": "Here is the implementation: "
  }
}
```
