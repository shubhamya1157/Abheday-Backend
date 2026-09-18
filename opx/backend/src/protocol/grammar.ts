
//Describe what an LLM is allowed to generate.

//Its job is to take your tool definitions written as JSON Schema and turn them into a GBNF grammar that can be given to llama.cpp so the model is forced to generate valid tool-call JSON.

//GBNF Grammer
//grammar rule.

// It’s a grammar format commonly used with LLM inference systems such as llama.cpp to constrain what an AI model is allowed to output.
//::= → means “is defined as” or “is replaced by”.
//Restricting an LLM to a fixed set of choices
//Ensuring generated text follows a particular syntax


//GBNF is a rule system that constrains an LLM's generated tokens so its output follows a specified grammar.

//It is used when there is a tool call and there is syntext error in that

//It is for llama.cpp (the C++ engine running the model), not the model weights itself.


import type { JsonSchema, ToolSchema } from "../core/types.ts";

const PRELUDE = `
ws      ::= [ \\t\\n]*
hex     ::= [0-9a-fA-F]
char    ::= [^"\\\\] | "\\\\" ["\\\\/bfnrt] | "\\\\u" hex hex hex hex
string  ::= "\\"" char* "\\""
integer ::= "-"? ("0" | [1-9] [0-9]*)
number  ::= integer ("." [0-9]+)? ([eE] [-+]? [0-9]+)?
boolean ::= "true" | "false"
null    ::= "null"
`.trim();


export function gbnfLiteral(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}


function ruleName(prefix: string, raw: string): string {
  return `${prefix}-${raw.replace(/[^A-Za-z0-9]/g, "-").toLowerCase()}`;
}

interface RuleAccumulator {
  rules: Map<string, string>;
  counter: number;
}


function schemaToGbnf(schema: JsonSchema | undefined, acc: RuleAccumulator): string {
  if (!schema) return "value-any";

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `(${schema.enum.map((v) => gbnfLiteral(String(v))).join(" | ")})`;
  }
  if (schema.const !== undefined) return gbnfLiteral(String(schema.const));

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return `(${schema.anyOf.map((s) => schemaToGbnf(s, acc)).join(" | ")})`;
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return `(${schema.oneOf.map((s) => schemaToGbnf(s, acc)).join(" | ")})`;
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const item = schemaToGbnf(schema.items, acc);
      const id = `arr${acc.counter++}`;
      acc.rules.set(id, `"[" ws (${item} (ws "," ws ${item})*)? ws "]"`);
      return id;
    }
    case "object": {
      const id = `obj${acc.counter++}`;
      acc.rules.set(id, objectBody(schema, acc));
      return id;
    }
    default:
      return "value-any";
  }
}


function objectBody(schema: JsonSchema, acc: RuleAccumulator): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const names = Object.keys(props);

  const requiredNames = names.filter((n) => required.has(n));
  const optionalNames = names.filter((n) => !required.has(n));

  if (names.length === 0) return `"{" ws "}"`;

  const parts: string[] = [`"{" ws`];

  requiredNames.forEach((name, idx) => {
    if (idx > 0) parts.push(`ws "," ws`);
    parts.push(`${gbnfLiteral(`"${name}"`)} ws ":" ws ${schemaToGbnf(props[name], acc)}`);
  });

  optionalNames.forEach((name) => {
    const leadingComma = requiredNames.length > 0 || optionalNames.indexOf(name) > 0;
    const inner = `${leadingComma ? `ws "," ws ` : ""}${gbnfLiteral(`"${name}"`)} ws ":" ws ${schemaToGbnf(props[name], acc)}`;
    parts.push(`(${inner})?`);
  });

  parts.push(`ws "}"`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------------- */

export interface ToolCallGrammarOptions {

  wrapInTags?: boolean;
  openTag?: string;
  closeTag?: string;

  onlyTool?: string;
}


export function buildToolCallGrammar(
  tools: readonly ToolSchema[],
  opts: ToolCallGrammarOptions = {},
): string | null {
  const selected = opts.onlyTool ? tools.filter((t) => t.name === opts.onlyTool) : tools;
  if (selected.length === 0) return null;

  const acc: RuleAccumulator = { rules: new Map(), counter: 0 };
  const callRuleIds: string[] = [];

  for (const tool of selected) {
    const argsExpr = schemaToGbnf({ ...tool.parameters, type: "object" }, acc);
    const id = ruleName("call", tool.name);
    acc.rules.set(
      id,
      `"{" ws "\\"name\\"" ws ":" ws ${gbnfLiteral(tool.name)} ws "," ws ` +
        `"\\"arguments\\"" ws ":" ws ${argsExpr} ws "}"`,
    );
    callRuleIds.push(id);
  }

  const wrap = opts.wrapInTags ?? true;
  const open = opts.openTag ?? "<tool_call>";
  const close = opts.closeTag ?? "</tool_call>";
  const callAlt = callRuleIds.join(" | ");

  const rootBody = wrap
    ? `${gbnfLiteral(open)} ws (${callAlt}) ws ${gbnfLiteral(close)}`
    : `(${callAlt})`;

  const lines = [`root ::= ${rootBody}`, ""];
  for (const [name, body] of acc.rules) lines.push(`${name} ::= ${body}`);
  lines.push("");
  lines.push(PRELUDE);
  // Only referenced if a schema had no usable type; harmless when unused.
  lines.push(`value-any ::= string | number | boolean | null`);

  return lines.join("\n");
}

export function buildJsonObjectGrammar(schema: JsonSchema): string {
  const acc: RuleAccumulator = { rules: new Map(), counter: 0 };
  const root = objectBody({ ...schema, type: "object" }, acc);
  const lines = [`root ::= ${root}`, ""];
  for (const [name, body] of acc.rules) lines.push(`${name} ::= ${body}`);
  lines.push("");
  lines.push(PRELUDE);
  lines.push(`value-any ::= string | number | boolean | null`);
  return lines.join("\n");
}
