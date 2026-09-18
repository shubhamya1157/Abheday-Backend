export type Modality = "text" | "image" | "pdf" | "document" | "structured-data";
export type OutputModality = "text" | "document" | "spreadsheet" | "presentation" | "code";
export type TaskType = "general" | "reasoning" | "coding" | "document" | "vision" | "analysis";
export type ReasoningLevel = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "blocked";
export type ModelRole = "general" | "reasoning" | "coding" | "vision" | "document" | "multimodal";
export type ToolTier = "read" | "write" | "execute";
export type GuardStage = "user_input" | "tool_args" | "tool_result" | "model_output";

// here sessionId corresponds to the conversationId itself
export interface AgentRequest {
  requestId?: string;
  userInput: string;
  sessionId?: string;
  context?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
}

export interface TaskProfile {
  taskType: TaskType;
  modalities: Modality[];
  reasoningLevel: ReasoningLevel;
  requiresTools: boolean;
  requiredCapabilities: string[];
  outputType: OutputModality;
  riskLevel: RiskLevel;
}

export interface ModelCapabilities {
  reasoning: number;
  coding: number;
  vision: number;
  document: number;
  toolCalling: boolean;
}

export interface ModelDescriptor {
  id: string;
  role: ModelRole;
  capabilities: ModelCapabilities;
  contextWindow: number;
  inputModalities: Modality[];
  outputModalities: OutputModality[];
  toolCalling: boolean;
  endpoint: string;
  runtime: "llama.cpp" | "other-local-runtime";
  resourceRequirements?: {
    vramGB?: number;
    ramGB?: number;
  };
  priority?: number;
  enabled: boolean;
}

export interface ModelSelection {
  model: ModelDescriptor;
  reason: string[];
}

export interface ModelRequest {
  prompt: string;
  systemPrompt?: string;
  messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
}

export interface ModelResponse {
  text: string;
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  model: string;
}

export interface ExecutionContext {
  runId: string;
  request: AgentRequest;
  task: TaskProfile;
  plan?: ExecutionPlan;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  selectedModel?: ModelDescriptor;
  observations: Observation[];
  toolCalls: ToolCallRecord[];
  artifacts: ArtifactRecord[];
  metadata: Record<string, unknown>;
  status: ExecutionStatus;
}

export interface Observation {
  kind: "tool_result" | "model_output" | "external";
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  tier: ToolTier;
  args: Record<string, unknown>;
  status: "requested" | "approved" | "executed" | "blocked";
  result?: string;
}

export interface ArtifactRecord {
  id: string;
  type: "text" | "document" | "spreadsheet" | "presentation" | "code";
  name: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionPlan {
  steps: PlanStep[];
}

export interface PlanStep {
  id: string;
  type: "model" | "tool" | "artifact" | "knowledge" | "document";
  description: string;
  requires?: string[];
}

export interface ModelGateway {
  generate(model: ModelDescriptor, request: ModelRequest, context?: ExecutionContext): Promise<ModelResponse>;
}

export interface Tool {
  name: string;
  description: string;
  tier: ToolTier;
  execute(args: Record<string, unknown>, context: ExecutionContext): Promise<{ ok: boolean; output: string; metadata?: Record<string, unknown> }>;
}

export interface AgentRunResult {
  runId: string;
  status: ExecutionStatus;
  output: string;
  trace: TraceEvent[];
  artifacts: ArtifactRecord[];
}

export interface TraceEvent {
  event: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface RoutingDecision {
  requested: TaskProfile;
  candidates: ModelDescriptor[];
  rejected: Array<{ model: ModelDescriptor; reason: string }>;
  selected: ModelDescriptor;
  reason: string[];
}
