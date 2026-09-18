import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */

// Same OPX design tokens as the homepage, so the workbench and the marketing
// site look like one product. The workbench lives entirely in "the machine
// room" (the dark room), because that is where OPX actually runs.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // room 1 — the plant office / paperwork (kept for parity with the site)
        paper: "#EDF0EC",
        "paper-2": "#E1E6DF",
        ink: "#0B0C0B",
        "ink-muted": "#5A6059",
        "ink-line": "#C9D0C7",

        // room 2 — the machine room (the workbench lives here)
        plant: "#08090A",
        "plant-2": "#101215",
        "plant-3": "#15181C",
        bone: "#E7E9E7",
        "bone-muted": "#7B8188",
        line: "#1E2126",

        // signals. one job each, never decoration.
        signal: "#FF8A2B", // live / running / the way into OPX
        sealed: "#57D98A", // verified / zero egress
        denied: "#FF4D3D", // a blocked outbound call

        // Node types, reused from the How-it-works canvas. On the workbench they
        // colour the run trace by what each step *is*, so you can read a run's
        // shape before reading a single label.
        node: {
          trigger: "#F472B6", // something asked: the request
          logic: "#60A5FA", // assembly and decisions
          guard: "#22D3EE", // the guards
          model: "#A78BFA", // the local model talking
          tool: "#2DD4BF", // the file tools
          out: "#57D98A", // artifact, receipt, end of run
        },
      },
      fontFamily: {
        wordmark: ['"Chakra Petch"', "Archivo", "sans-serif"],
        display: ["Archivo", "Arial Black", "Helvetica Neue", "sans-serif"],
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "Menlo", "monospace"],
        aside: ["Newsreader", "Georgia", "serif"],
      },
      letterSpacing: {
        label: "0.18em",
      },
      maxWidth: {
        page: "78rem",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.25" },
        },
        caret: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        // a step that just arrived slides up from nothing
        risein: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        breathe: "breathe 1.8s ease-in-out infinite",
        caret: "caret 1s step-end infinite",
        risein: "risein 240ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
      },
    },
  },
  plugins: [animate],
};
