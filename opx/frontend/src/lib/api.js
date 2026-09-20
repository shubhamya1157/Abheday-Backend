// All talk to the OPX backend lives here, so the components never touch fetch
// directly. The dev server proxies /api to http://127.0.0.1:8787 (see
// vite.config.js), so the base is just "/api/v1" in development.
//
// If you set an API token on the backend (HTTP_HOST is non-loopback), put the
// same token in localStorage under "opx_token" and every call sends it.

const BASE = "/api/v1";

function authHeaders() {
  const token = localStorage.getItem("opx_token");
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function getJson(path) {
  const res = await fetch(BASE + path, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

// --- read-only inspection endpoints ---------------------------------------

export function getHealth() {
  return getJson("/health");
}

export function getModels() {
  return getJson("/models");
}

export function getTools() {
  return getJson("/tools");
}

// The composed system prompt comes back as plain text, not JSON, so read it
// with .text() rather than getJson().
export async function getSystemPrompt() {
  const res = await fetch(BASE + "/system-prompt", { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`/system-prompt returned ${res.status}`);
  return res.text();
}

// --- receipt verify + render ----------------------------------------------

// Independently re-check a receipt's ordering and gaps. Returns
// { valid, brokenAt?, reason?, entriesChecked }.
export async function verifyReceipt(receipt) {
  const res = await fetch(BASE + "/receipt/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(receipt),
  });
  return res.json();
}

// Turn a receipt into the Markdown a human reads. Comes back as plain text.
export async function renderReceipt(receipt) {
  const res = await fetch(BASE + "/receipt/render", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(receipt),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(detail || `/receipt/render returned ${res.status}`);
  }
  return res.text();
}

// --- the run, streamed with Server-Sent Events -----------------------------
//
// The backend sends one SSE frame per step: `event: <name>` then `data: <json>`.
// We read the response body as a stream, split it into frames, and hand each
// parsed event to onEvent(). Event names match the backend's AgentEvent union
// plus "receipt" and "done" at the end, and "error" if something failed.
//
// Returns a function you can call to abort the run (e.g. a Stop button).

export function chatStream({ input, sessionId, history, onEvent, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(BASE + "/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ input, sessionId, history, stream: true }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await safeText(res);
        throw new Error(detail || `stream returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Frames are separated by a blank line. Keep the last partial frame in
        // the buffer until its terminating blank line arrives.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const event = parseFrame(frame);
          if (event) onEvent(event);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return; // user stopped it; not an error
      onError?.(err);
    }
  })();

  return () => controller.abort();
}

// Turn one raw SSE frame ("event: x\ndata: {...}\ndata: {...}") into
// { type, ...payload }. Multiple data: lines are joined back with newlines.
function parseFrame(frame) {
  let name = "message";
  const dataLines = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }

  if (dataLines.length === 0) return null;

  try {
    const payload = JSON.parse(dataLines.join("\n"));
    // The AgentEvent frames already carry their own `type`; the terminal
    // frames (receipt/done/error) are named only by the event line.
    return payload.type ? payload : { type: name, ...payload };
  } catch {
    return null;
  }
}

async function safeText(res) {
  try {
    const body = await res.json();
    return body?.error?.message ?? body?.error ?? "";
  } catch {
    return "";
  }
}
