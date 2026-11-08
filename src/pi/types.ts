/**
 * Strict TypeScript types and type guards for Pi AI-agent RPC protocol (pi --mode rpc).
 */

// ---------------------------------------------------------------------------
// Stdin Command Types
// ---------------------------------------------------------------------------

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface PromptCommand {
  id: string;
  type: "prompt";
  message: string | ContentPart[];
  images?: ImageContentPart[];
  streamingBehavior?: "steer" | "followUp";
}

export interface AbortCommand {
  id: string;
  type: "abort";
}

export interface GetStateCommand {
  id: string;
  type: "get_state";
}

export type RpcCommand = PromptCommand | AbortCommand | GetStateCommand;

// ---------------------------------------------------------------------------
// Stdout Event Types
// ---------------------------------------------------------------------------

export interface TextDelta {
  type: "text_delta";
  contentIndex?: number;
  delta: string;
}

export interface ThinkingDelta {
  type: "thinking_delta";
  contentIndex?: number;
  delta: string;
}

export interface ToolCallDelta {
  type: "toolcall_delta";
  contentIndex?: number;
  delta?: string;
  args?: string;
}

export type AssistantMessageDelta =
  | TextDelta
  | ThinkingDelta
  | ToolCallDelta
  | { type: string; [key: string]: unknown };

export interface AgentStartEvent {
  type: "agent_start";
}

export interface TurnStartEvent {
  type: "turn_start";
}

export interface MessageStartEvent {
  type: "message_start";
  message?: unknown;
}

export interface MessageUsage {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  [key: string]: unknown;
}

export interface MessageUpdateEvent {
  type: "message_update";
  usage?: MessageUsage;
  assistantMessageEvent: AssistantMessageDelta;
}

export interface ToolCallStartEvent {
  type: "toolcall_start";
  toolName: string;
  id?: string;
  callId?: string;
  args?: Record<string, unknown> | unknown;
  input?: Record<string, unknown> | unknown;
}

export interface ToolCallEndEvent {
  type: "toolcall_end";
  id?: string;
  callId?: string;
  toolCall?: unknown;
  output?: unknown;
  error?: string | unknown;
}

export interface TurnEndEvent {
  type: "turn_end";
  message?: unknown;
  toolResults?: unknown;
}

export interface AgentEndEvent {
  type: "agent_end";
  willRetry?: boolean;
}

export interface AgentSettledEvent {
  type: "agent_settled";
  aborted?: boolean;
}

export interface PiErrorEvent {
  type: "error";
  message: string;
  code?: string | number;
  details?: unknown;
}

export interface PiWarningEvent {
  type: "warning";
  message: string;
  details?: unknown;
}

export interface PiResponseEvent {
  type: "response";
  id: string;
  success?: boolean;
  data?: unknown;
  error?: string | unknown;
}

export type PiRpcEvent =
  | AgentStartEvent
  | TurnStartEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | TurnEndEvent
  | AgentEndEvent
  | AgentSettledEvent
  | PiErrorEvent
  | PiWarningEvent
  | PiResponseEvent;

// ---------------------------------------------------------------------------
// Client Event Emitter Contract
// ---------------------------------------------------------------------------

export type PiClientStatus = "idle" | "streaming" | "closed";

export interface PiClientEvents {
  token: (delta: string) => void;
  tool_start: (event: ToolCallStartEvent) => void;
  tool_end: (event: ToolCallEndEvent) => void;
  settled: (event: AgentSettledEvent) => void;
  error: (error: Error | PiErrorEvent) => void;
  event: (rawEvent: PiRpcEvent) => void;
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPromptCommand(value: unknown): value is PromptCommand {
  if (!isRecord(value)) return false;
  return (
    value.type === "prompt" &&
    typeof value.id === "string" &&
    (typeof value.message === "string" || Array.isArray(value.message))
  );
}

export function isAbortCommand(value: unknown): value is AbortCommand {
  if (!isRecord(value)) return false;
  return value.type === "abort" && typeof value.id === "string";
}

export function isGetStateCommand(value: unknown): value is GetStateCommand {
  if (!isRecord(value)) return false;
  return value.type === "get_state" && typeof value.id === "string";
}

const COMMAND_VALIDATORS: Record<string, (val: unknown) => boolean> = {
  prompt: isPromptCommand,
  abort: isAbortCommand,
  get_state: isGetStateCommand,
};

export function isRpcCommand(value: unknown): value is RpcCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  const validator = COMMAND_VALIDATORS[value.type];
  return validator !== undefined && validator(value);
}

export function isAgentStartEvent(value: unknown): value is AgentStartEvent {
  return isRecord(value) && value.type === "agent_start";
}

export function isTurnStartEvent(value: unknown): value is TurnStartEvent {
  return isRecord(value) && value.type === "turn_start";
}

export function isMessageStartEvent(value: unknown): value is MessageStartEvent {
  return isRecord(value) && value.type === "message_start";
}

export function isMessageUpdateEvent(value: unknown): value is MessageUpdateEvent {
  return isRecord(value) && value.type === "message_update" && isRecord(value.assistantMessageEvent);
}

export function isToolCallStartEvent(value: unknown): value is ToolCallStartEvent {
  return isRecord(value) && value.type === "toolcall_start" && typeof value.toolName === "string";
}

export function isToolCallEndEvent(value: unknown): value is ToolCallEndEvent {
  return isRecord(value) && value.type === "toolcall_end";
}

export function isTurnEndEvent(value: unknown): value is TurnEndEvent {
  return isRecord(value) && value.type === "turn_end";
}

export function isAgentEndEvent(value: unknown): value is AgentEndEvent {
  return isRecord(value) && value.type === "agent_end";
}

export function isAgentSettledEvent(value: unknown): value is AgentSettledEvent {
  return isRecord(value) && value.type === "agent_settled";
}

export function isErrorEvent(value: unknown): value is PiErrorEvent {
  return isRecord(value) && value.type === "error" && typeof value.message === "string";
}

export function isWarningEvent(value: unknown): value is PiWarningEvent {
  return isRecord(value) && value.type === "warning" && typeof value.message === "string";
}

export function isResponseEvent(value: unknown): value is PiResponseEvent {
  return isRecord(value) && value.type === "response" && typeof value.id === "string";
}

const EVENT_VALIDATORS: Record<string, (val: unknown) => boolean> = {
  agent_start: isAgentStartEvent,
  turn_start: isTurnStartEvent,
  message_start: isMessageStartEvent,
  message_update: isMessageUpdateEvent,
  toolcall_start: isToolCallStartEvent,
  toolcall_end: isToolCallEndEvent,
  turn_end: isTurnEndEvent,
  agent_end: isAgentEndEvent,
  agent_settled: isAgentSettledEvent,
  error: isErrorEvent,
  warning: isWarningEvent,
  response: isResponseEvent,
};

export function isRpcEvent(value: unknown): value is PiRpcEvent {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  const validator = EVENT_VALIDATORS[value.type];
  return validator !== undefined && validator(value);
}

/**
 * Extracts raw delta string from a message_update event if it contains a text_delta.
 */
export function extractTextDelta(event: MessageUpdateEvent | PiRpcEvent): string | undefined {
  if (!isMessageUpdateEvent(event)) {
    return undefined;
  }
  const deltaEvent = event.assistantMessageEvent;
  if (deltaEvent && deltaEvent.type === "text_delta" && typeof deltaEvent.delta === "string") {
    return deltaEvent.delta;
  }
  return undefined;
}
