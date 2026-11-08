import { describe, it, expect } from "vitest";
import {
  // Command guards & types
  isRpcCommand,
  isPromptCommand,
  isAbortCommand,
  isGetStateCommand,
  type RpcCommand,
  type PromptCommand,
  type AbortCommand,
  type GetStateCommand,
  // Event guards & types
  isRpcEvent,
  isAgentStartEvent,
  isTurnStartEvent,
  isMessageStartEvent,
  isMessageUpdateEvent,
  isToolCallStartEvent,
  isToolCallEndEvent,
  isTurnEndEvent,
  isAgentEndEvent,
  isAgentSettledEvent,
  isErrorEvent,
  isWarningEvent,
  isResponseEvent,
  extractTextDelta,
  type PiRpcEvent,
  type MessageUpdateEvent,
  type ToolCallStartEvent,
  type ToolCallEndEvent,
  type AgentSettledEvent,
} from "../src/pi/types.js";

describe("Pi RPC Commands", () => {
  it("identifies valid PromptCommand with string message", () => {
    const cmd = {
      id: "req-1",
      type: "prompt",
      message: "Write a script to parse logs",
    };

    expect(isRpcCommand(cmd)).toBe(true);
    expect(isPromptCommand(cmd)).toBe(true);
    expect(isAbortCommand(cmd)).toBe(false);
  });

  it("identifies PromptCommand with ContentPart array message", () => {
    const cmd: PromptCommand = {
      id: "req-parts-1",
      type: "prompt",
      message: [
        { type: "text", text: "Look at this:" },
        { type: "image", data: "base64...", mimeType: "image/png" },
      ],
    };

    expect(isRpcCommand(cmd)).toBe(true);
    expect(isPromptCommand(cmd)).toBe(true);
  });

  it("identifies PromptCommand with images and streamingBehavior", () => {
    const cmd: PromptCommand = {
      id: "req-2",
      type: "prompt",
      message: "Explain this architecture diagram",
      images: [
        {
          type: "image",
          data: "base64data",
          mimeType: "image/jpeg",
        },
      ],
      streamingBehavior: "steer",
    };

    expect(isRpcCommand(cmd)).toBe(true);
    expect(isPromptCommand(cmd)).toBe(true);
  });

  it("identifies AbortCommand", () => {
    const cmd: AbortCommand = {
      id: "req-abort-1",
      type: "abort",
    };

    expect(isRpcCommand(cmd)).toBe(true);
    expect(isAbortCommand(cmd)).toBe(true);
    expect(isPromptCommand(cmd)).toBe(false);
  });

  it("identifies GetStateCommand", () => {
    const cmd: GetStateCommand = {
      id: "req-state-1",
      type: "get_state",
    };

    expect(isRpcCommand(cmd)).toBe(true);
    expect(isGetStateCommand(cmd)).toBe(true);
  });

  it("rejects invalid commands", () => {
    expect(isRpcCommand(null)).toBe(false);
    expect(isRpcCommand(undefined)).toBe(false);
    expect(isRpcCommand([])).toBe(false);
    expect(isRpcCommand("string")).toBe(false);
    expect(isRpcCommand({})).toBe(false);
    expect(isRpcCommand({ type: "unknown", id: "1" })).toBe(false);
    expect(isRpcCommand({ type: "prompt" })).toBe(false);
    expect(isRpcCommand({ type: "prompt", id: 123, message: "hi" })).toBe(false);
    expect(isRpcCommand({ type: "prompt", id: "1", message: 123 })).toBe(false);
    expect(isRpcCommand({ type: "abort" })).toBe(false);
    expect(isRpcCommand({ type: "abort", id: 123 })).toBe(false);
    expect(isRpcCommand({ type: "get_state" })).toBe(false);
    expect(isRpcCommand({ type: "get_state", id: 123 })).toBe(false);

    expect(isPromptCommand(null)).toBe(false);
    expect(isAbortCommand(null)).toBe(false);
    expect(isGetStateCommand(null)).toBe(false);
  });
});

describe("Pi RPC Events & Type Guards", () => {
  it("recognizes agent_start and turn_start events", () => {
    const agentStart = { type: "agent_start" };
    const turnStart = { type: "turn_start" };

    expect(isRpcEvent(agentStart)).toBe(true);
    expect(isAgentStartEvent(agentStart)).toBe(true);

    expect(isRpcEvent(turnStart)).toBe(true);
    expect(isTurnStartEvent(turnStart)).toBe(true);
  });

  it("recognizes message_start and message_update with text_delta", () => {
    const messageStart = { type: "message_start", message: { id: "m-1" } };
    expect(isMessageStartEvent(messageStart)).toBe(true);

    const messageUpdate: MessageUpdateEvent = {
      type: "message_update",
      usage: { totalTokens: 142 },
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Here is the implementation: ",
      },
    };

    expect(isRpcEvent(messageUpdate)).toBe(true);
    expect(isMessageUpdateEvent(messageUpdate)).toBe(true);
    expect(extractTextDelta(messageUpdate)).toBe("Here is the implementation: ");
  });

  it("extracts undefined delta when message_update contains non-text delta", () => {
    const messageUpdate: MessageUpdateEvent = {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        delta: "ignored",
      },
    };

    expect(isMessageUpdateEvent(messageUpdate)).toBe(true);
    expect(extractTextDelta(messageUpdate)).toBeUndefined();

    // Passing a non-message_update event to extractTextDelta
    const agentStart = { type: "agent_start" as const };
    expect(extractTextDelta(agentStart as any)).toBeUndefined();
  });

  it("recognizes toolcall_start and toolcall_end events", () => {
    const toolStart = {
      type: "toolcall_start",
      toolName: "bash",
      id: "call-123",
      args: { command: "git status" },
    };

    expect(isRpcEvent(toolStart)).toBe(true);
    expect(isToolCallStartEvent(toolStart)).toBe(true);

    const toolEnd = {
      type: "toolcall_end",
      id: "call-123",
      output: "On branch main",
    };

    expect(isRpcEvent(toolEnd)).toBe(true);
    expect(isToolCallEndEvent(toolEnd)).toBe(true);
  });

  it("recognizes turn_end, agent_end, and agent_settled events", () => {
    const turnEnd = { type: "turn_end" };
    const agentEnd = { type: "agent_end", willRetry: false };
    const settled = { type: "agent_settled", aborted: false };

    expect(isTurnEndEvent(turnEnd)).toBe(true);
    expect(isAgentEndEvent(agentEnd)).toBe(true);
    expect(isAgentSettledEvent(settled)).toBe(true);
  });

  it("recognizes error, warning, and response events", () => {
    const err = { type: "error", message: "Fatal model error", code: 500 };
    const warn = { type: "warning", message: "Token limit approaching" };
    const res = { type: "response", id: "req-state-1", success: true, data: { model: "claude" } };

    expect(isErrorEvent(err)).toBe(true);
    expect(isWarningEvent(warn)).toBe(true);
    expect(isResponseEvent(res)).toBe(true);
  });

  it("rejects invalid events", () => {
    expect(isRpcEvent(null)).toBe(false);
    expect(isRpcEvent(undefined)).toBe(false);
    expect(isRpcEvent([])).toBe(false);
    expect(isRpcEvent("string")).toBe(false);
    expect(isRpcEvent({})).toBe(false);
    expect(isRpcEvent({ type: 123 })).toBe(false);
    expect(isRpcEvent({ type: "unknown_custom_type" })).toBe(false);
    expect(isRpcEvent({ type: "toolcall_start" })).toBe(false); // missing toolName
    expect(isRpcEvent({ type: "error" })).toBe(false); // missing message
    expect(isRpcEvent({ type: "warning" })).toBe(false); // missing message
    expect(isRpcEvent({ type: "response" })).toBe(false); // missing id
    expect(isRpcEvent({ type: "message_update" })).toBe(false); // missing assistantMessageEvent

    expect(isAgentStartEvent(null)).toBe(false);
    expect(isTurnStartEvent(null)).toBe(false);
    expect(isMessageStartEvent(null)).toBe(false);
    expect(isMessageUpdateEvent(null)).toBe(false);
    expect(isToolCallStartEvent(null)).toBe(false);
    expect(isToolCallEndEvent(null)).toBe(false);
    expect(isTurnEndEvent(null)).toBe(false);
    expect(isAgentEndEvent(null)).toBe(false);
    expect(isAgentSettledEvent(null)).toBe(false);
    expect(isErrorEvent(null)).toBe(false);
    expect(isWarningEvent(null)).toBe(false);
    expect(isResponseEvent(null)).toBe(false);
  });
});
