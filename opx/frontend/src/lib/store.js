// Where chats and projects actually live. The backend runs the model and
// streams a run, but it does not remember your chat list — so the list of past
// conversations and the projects you group them into are kept here, in the
// browser (localStorage). This is what makes History and Projects real and not
// just static boxes: refresh the page and your chats are still here.
//
// Nothing here talks to the network. It is all read/write to localStorage.

const CHATS_KEY = "opx_chats";
const PROJECTS_KEY = "opx_projects";
const PREFS_KEY = "opx_prefs";

// small helper: read a JSON value, fall back to a default if it is missing or
// somehow corrupt (so a bad write can never white-screen the app)
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked — nothing we can do, just don't crash
  }
}

// a short random id with a readable prefix, e.g. "chat_k3f9a1"
export function makeId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

// --- chats -----------------------------------------------------------------

// A chat is one conversation. It owns its messages, its backend sessionId (so
// the model's memory is per-chat), and which project it belongs to (or none).
export function blankChat(projectId = null) {
  const now = Date.now();
  return {
    id: makeId("chat"),
    title: "New chat",
    projectId,
    sessionId: makeId("sess"),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadChats() {
  return read(CHATS_KEY, []);
}

export function saveChats(chats) {
  write(CHATS_KEY, chats);
}

// Give a brand-new chat a title from the first thing the user said, the way
// Claude/GPT do. Keep it short and single-line.
export function titleFrom(text) {
  const line = String(text).replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  return line.length > 40 ? line.slice(0, 40) + "…" : line;
}

// --- projects --------------------------------------------------------------

// A project groups chats and can carry standing instructions that get sent
// ahead of every chat inside it (like a Claude project's custom instructions).
export function blankProject(name = "Untitled project") {
  return {
    id: makeId("proj"),
    name,
    instructions: "",
    createdAt: Date.now(),
  };
}

export function loadProjects() {
  return read(PROJECTS_KEY, []);
}

export function saveProjects(projects) {
  write(PROJECTS_KEY, projects);
}

// --- preferences -----------------------------------------------------------

// Small UI preferences that should stick between visits. The API token is kept
// separately under "opx_token" because lib/api.js reads it directly.
const DEFAULT_PREFS = {
  showTrace: false, // open each answer's run details by default
};

export function loadPrefs() {
  return { ...DEFAULT_PREFS, ...read(PREFS_KEY, {}) };
}

export function savePrefs(prefs) {
  write(PREFS_KEY, prefs);
}

// --- a couple of formatting helpers the sidebar/history use ----------------

// "just now", "5m", "3h", "2d", or a date once it is more than a week old.
export function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Bucket a timestamp into Today / Yesterday / Previous, so the history list can
// group like the apps do.
export function bucket(ts) {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const t = startOfToday.getTime();
  if (ts >= t) return "Today";
  if (ts >= t - day) return "Yesterday";
  return "Previous";
}
