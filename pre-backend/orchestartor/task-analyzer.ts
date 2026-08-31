import type { Modality, OutputModality, RiskLevel, TaskProfile, TaskType } from "./types.js";

export type { TaskProfile } from "./types.js";

export function classifyTask(input: string): TaskProfile {
  const text = input.toLowerCase();

  const taskType: TaskType = text.includes("code") || text.includes("script") || text.includes("function")
    ? "coding"
    : text.includes("image") || text.includes("photo") || text.includes("scan") || text.includes("ocr") || text.includes("vision")
      ? "vision"
      : text.includes("document") || text.includes("pdf") || text.includes("report") || text.includes("summary")
        ? "document"
        : text.includes("analyze") || text.includes("compare") || text.includes("reason") || text.includes("decision")
          ? "reasoning"
          : "general";

  const modalities: Modality[] = [];
  if (text.includes("image") || text.includes("photo") || text.includes("scan") || text.includes("vision")) modalities.push("image");
  if (text.includes("pdf") || text.includes("document") || text.includes("report")) modalities.push("pdf", "document");
  if (modalities.length === 0) modalities.push("text");

  const requiredCapabilities = new Set<string>();
  if (taskType === "coding") requiredCapabilities.add("coding");
  if (taskType === "vision" || modalities.includes("image")) requiredCapabilities.add("vision");
  if (taskType === "document" || modalities.includes("pdf")) requiredCapabilities.add("document");
  if (taskType === "reasoning") requiredCapabilities.add("reasoning");
  if (text.includes("tool") || text.includes("search") || text.includes("file")) requiredCapabilities.add("tool-calling");
  if (requiredCapabilities.size === 0) requiredCapabilities.add("general");

  const outputType: OutputModality = taskType === "coding" ? "code" : taskType === "document" ? "document" : "text";
  const reasonLevel = taskType === "reasoning" || text.includes("analysis") ? "high" : taskType === "coding" ? "medium" : "low";
  const riskLevel: RiskLevel = text.includes("secret") || text.includes("password") || text.includes("approval") || text.includes("defence") ? "high" : taskType === "document" ? "medium" : "low";

  return {
    taskType,
    modalities,
    reasoningLevel: reasonLevel,
    requiresTools: text.includes("search") || text.includes("tool") || text.includes("file") || text.includes("document") || text.includes("report"),
    requiredCapabilities: [...requiredCapabilities],
    outputType,
    riskLevel,
  };
}
