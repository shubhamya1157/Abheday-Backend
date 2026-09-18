import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */

// OPX design tokens live here so every colour on the page has a name and a job.
// Two "rooms": paper (the plant office, above the cut) and plant (the machine
// room, below the cut). Signals are used on purpose and almost never.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // room 1 — the plant office / paperwork
        paper: "#EDF0EC",
        "paper-2": "#E1E6DF",
        ink: "#0B0C0B",
        "ink-muted": "#5A6059",
        "ink-line": "#C9D0C7",

        // room 2 — the machine room
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

        // Node types on the How-it-works canvas. n8n colours a workflow by
        // what each node *is*, so you can read the shape of a flow before you
        // read a single label — that is what these are for, and they are used
        // nowhere else on the page.
        node: {
          trigger: "#F472B6", // something asked: the HTTP request
          logic: "#60A5FA", // assembly and decisions
          guard: "#22D3EE", // the hooks, the path jail, the egress guard
          model: "#A78BFA", // the local model
          tool: "#2DD4BF", // the file tools
          out: "#57D98A", // artifact, receipt, end of run
        },
      },
      fontFamily: {
        // the wordmark, and nothing else. Chakra Petch is squared and technical
        // and comes from an Indian foundry — it looks stencilled onto a panel.
        wordmark: ['"Chakra Petch"', "Archivo", "sans-serif"],

        // display face. Archivo is variable, so we can stretch it wide like a
        // nameplate stamped on equipment (see .punch in index.css)
        display: ["Archivo", "Arial Black", "Helvetica Neue", "sans-serif"],
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "Menlo", "monospace"],

        // used sparingly, in italic, for the one human voice on the page
        aside: ["Newsreader", "Georgia", "serif"],
      },
      letterSpacing: {
        label: "0.18em",
      },
      // the length of the cut, so the navbar and the <body> repaint together
      transitionDuration: {
        cut: "420ms",
      },
      maxWidth: {
        page: "78rem",
      },
      keyframes: {
        // the fence energising: one hairline sweeps across, left to right
        sweep: {
          "0%": { transform: "scaleX(0)", transformOrigin: "left", opacity: "1" },
          "70%": { transform: "scaleX(1)", transformOrigin: "left", opacity: "1" },
          "100%": { transform: "scaleX(1)", opacity: "0" },
        },
        // the amber dot that means "this thing is running right now"
        breathe: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.25" },
        },
        caret: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
      },
      animation: {
        sweep: "sweep 620ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
        breathe: "breathe 1.8s ease-in-out infinite",
        caret: "caret 1s step-end infinite",
      },
    },
  },
  plugins: [animate],
};
