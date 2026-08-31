export interface CoreGuardRailsConfig{
    level: "standard" | "basic" | "advanced";
    outputBlockStrategy: "sanitize" | "block";
    blockedResponse:{
        response: string,
        data: Record<string,unknown>,
    };
    enabledGuards?: Array<"injection" | "pii" | "secrets" | "toxicity" | "leakage">;
}

export interface LoadOutcome {
  loaded: boolean;
  reason: string;
}

