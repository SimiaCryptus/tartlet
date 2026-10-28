// Type declarations for the dependency-free cognotik-client.mjs (only the parts the playground uses).

export const VERSION: string;
export const DEFAULT_URL: string;
export const DEFAULT_PROVIDERS: string[];
export const DEFAULT_COOKIE_NAME: string;
export const IS_BROWSER: boolean;

export interface ChatModel {
  modelId?: string;
  name?: string;
  provider?: string | { name?: string };
  deprecated?: boolean;
  outputModalities?: unknown[];
  [key: string]: unknown;
}

export interface MessagePart {
  type: string;
  text?: string;
  image_url?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessagePart[] | string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

export interface ChatResponse {
  choices?: { message?: { content?: string | (MessagePart | string)[] }; text?: string }[];
  usage?: Usage;
  [key: string]: unknown;
}

export class CognotikError extends Error {
  constructor(
    message: string,
    opts?: { status?: number; body?: string; retryable?: boolean; auth?: boolean; aborted?: boolean; cause?: unknown },
  );
  status?: number;
  body?: string;
  retryable: boolean;
  auth: boolean;
  aborted: boolean;
}

export interface CognotikClientOptions {
  baseUrl?: string;
  providers?: string[];
  token?: string;
  cookieName?: string;
  apiKey?: string;
  session?: string;
  chatTimeoutMs?: number;
  connectTimeoutMs?: number;
  modelsTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollInitialMs?: number;
  pollMaxMs?: number;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  userAgent?: string;
  sendCookieHeader?: boolean;
  verbose?: boolean;
  logger?: (message: string) => void;
}

export interface CallOptions {
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export class CognotikClient {
  constructor(options?: CognotikClientOptions);
  readonly baseUrl: string;
  session: string;
  listModels(opts?: { signal?: AbortSignal }): Promise<ChatModel[]>;
  chat(request: ChatRequest, opts?: CallOptions): Promise<ChatResponse>;
  ask(
    prompt: string,
    opts: CallOptions & {
      model: string;
      system?: string;
      temperature?: number;
      maxTokens?: number;
      attachments?: MessagePart[];
    },
  ): Promise<{ text: string; response: ChatResponse }>;
}

export class Conversation {
  constructor(init?: { system?: string | null; messages?: ChatMessage[] });
  system: string | null;
  messages: ChatMessage[];
  addUser(parts: MessagePart[]): void;
  addAssistant(text: string): void;
  toMessages(): ChatMessage[];
  undo(): number;
}

export class UsageTracker {
  requests: number;
  prompt: number;
  completion: number;
  cost: number;
  add(u: Usage | undefined): void;
  static format(u: Usage | undefined): string;
  summary(): string;
}

export function buildRequest(
  conv: Conversation,
  settings: { model: string; temperature?: number; maxTokens?: number },
): ChatRequest;
export function extractText(resp: ChatResponse | null | undefined): string;
export function textPart(text: string): MessagePart;
export function providerName(m: ChatModel | null | undefined): string;
export function isTextModel(m: ChatModel | null | undefined): boolean;
export function chooseDefaultModel(models: ChatModel[]): ChatModel | null;
export function matchModels(models: ChatModel[], query: string): ChatModel[];
export function newSessionId(): string;
