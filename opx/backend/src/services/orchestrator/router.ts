import type {
  ExecutionContext,
  ModelDescriptor,
  ModelSelection,
  RoutingDecision,
  TaskProfile,
} from "./types.ts";

export class CapabilityRouter {
  models: ModelDescriptor[];
  constructor(models: ModelDescriptor[]) {
    this.models = models;
  }

  private isCompatible(model: ModelDescriptor, task: TaskProfile, context: ExecutionContext): boolean {
    const required = new Set(task.requiredCapabilities);
    const capabilityCheck = (
      model.capabilities.reasoning >= (task.reasoningLevel === "high" ? 3 : task.reasoningLevel === "medium" ? 2 : 1) &&
      (required.has("coding") ? model.capabilities.coding > 0 : true) &&
      (required.has("vision") ? model.capabilities.vision > 0 : true) &&
      (required.has("document") ? model.capabilities.document > 0 : true) &&
      (task.requiresTools ? model.toolCalling : true)
    );

    const modalityCheck = task.modalities.every((modality) => model.inputModalities.includes(modality) || modality === "text");
    const outputCheck = task.outputType ? model.outputModalities.includes(task.outputType) || model.outputModalities.includes("text") : true;
    const runtimeCheck = model.runtime === "llama.cpp" || model.runtime === "other-local-runtime";

    if (!capabilityCheck || !modalityCheck || !outputCheck || !runtimeCheck) {
      return false;
    }

    if (context.metadata?.runtimeConstraints && typeof context.metadata.runtimeConstraints === "object") {
      const constraints = context.metadata.runtimeConstraints as Record<string, number>;
      if (constraints.vramGB && model.resourceRequirements?.vramGB && model.resourceRequirements.vramGB > constraints.vramGB) {
        return false;
      }
      if (constraints.ramGB && model.resourceRequirements?.ramGB && model.resourceRequirements.ramGB > constraints.ramGB) {
        return false;
      }
    }

    return true;
  }

  decision(task: TaskProfile, context: ExecutionContext): RoutingDecision {
    const candidates = this.models?.filter((model:ModelDescriptor) => model.enabled && this.isCompatible(model, task, context));
    const selected = candidates.sort((a:ModelDescriptor, b:ModelDescriptor) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (!selected) {
      throw new Error("No compatible local model available for the requested task");
    }

    const rejected = this.models
      .filter((model:ModelDescriptor) => model.enabled && !this.isCompatible(model, task, context))
      .map((model:ModelDescriptor) => ({ model, reason: "capabilities or modality mismatch" }));

    return {
      requested: task,
      candidates,
      rejected,
      selected,
      reason: [`selected ${selected.id} based on required capabilities and availability`],
    };
  }

   async route(task: TaskProfile, context: ExecutionContext): Promise<ModelSelection> {
    const candidates = this.models.filter((model:ModelDescriptor) => model.enabled && this.isCompatible(model, task, context));
    const rejected: Array<{ model: ModelDescriptor; reason: string }> = [];

    for (const model of this.models) {
      if (!model.enabled) {
        rejected.push({ model, reason: "model disabled" });
        continue;
      }
      if (!this.isCompatible(model, task, context)) {
        rejected.push({ model, reason: "capabilities or modality mismatch" });
      }
    }

    if (candidates.length === 0) {
      throw new Error("No compatible local model available for the requested task");
    }

    const selected:ModelDescriptor = [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] as ModelDescriptor;
    const reasons: string[] = [];

    if (task.requiredCapabilities.includes("coding")) reasons.push("coding capability required");
    if (task.requiredCapabilities.includes("vision")) reasons.push("vision capability required");
    if (task.requiredCapabilities.includes("document")) reasons.push("document capability required");
    if (task.reasoningLevel !== "low") reasons.push(`reasoning level ${task.reasoningLevel} required`);
    if (task.requiresTools && selected?.toolCalling) reasons.push("tool calling supported");
    if (selected?.role === "general") reasons.push("general execution path selected");

    return { model: selected, reason: reasons };
  }
  
}
