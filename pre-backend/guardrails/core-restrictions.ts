import {GuardrailEngine,type GuardrailResult,type DetectionLevel} from "@llm-guardrails/core";
import type { CoreGuardRailsConfig, LoadOutcome } from "./interface.guardrails.js";

const engine = new GuardrailEngine();

async function interpretMessage(message:{}){
    if(!message){
        return {"status":400,"error":"No message has been provided"}
    }
    // const result = await engine.checkInput();
    // if (result.blocked) 
    //     throw new Error(result.reason);
    // return {"status":400,"error":result.reason}
}

const defaultGuardRails=(
    level: CoreGuardRailsConfig["level"] = "standard",
    outputBlockStrategy: CoreGuardRailsConfig["outputBlockStrategy"]  = "block",
    data: Record<string, unknown> = {},
    ):CoreGuardRailsConfig=>{
    return {
        level,
        outputBlockStrategy,
        blockedResponse:{
            response: "This message has been blocked by the guardrails.",
            data,
        },
        enabledGuards:["injection", "pii", "secrets", "toxicity", "leakage"],
    };
}

export async function loadExternalEngine(
    config:CoreGuardRailsConfig=defaultGuardRails(),
):Promise<{engine:GuardrailEngine | null; outcome:LoadOutcome}>{
    const enabledGuardRail = config.enabledGuards;

    try {
        const engine = new GuardrailEngine({
            // don't change name as SDK want in thsi way..
            guards: enabledGuardRail!.map((name)=>({name,enabled:true})),
            level: config.level,
            outputBlockStrategy: config.outputBlockStrategy,
            blockedMessage: config.blockedResponse?.response ?? "This message has been blocked by the guardrails."
        })
        await engine.checkInput("healthcheck", { sessionId: "boot" });
        await engine.checkOutput("healthcheck", { sessionId: "boot" });
        return { engine, outcome: { loaded: true, reason: "loaded and smoke-tested" } };
    } 
    catch (err) {
        return {
            engine: null,
            outcome: {
                loaded: false,
                reason: err instanceof Error ? err.message : "Engine initialization failed",
            },
        };
    }
}














