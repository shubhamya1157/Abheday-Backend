# OPX — homepage

Run it:

```bash
cd opx-home
npm install
npm run dev
```

## What is where

| File | What it does |
| --- | --- |
| `src/App.jsx` | Holds the one piece of page state: which "room" you are in. Flips the navbar and the page background when you scroll past the hero. |
| `src/components/Hero.jsx` | Cream room. The punch line, revealed as one orchestrated sequence on load. |
| `src/components/HowItWorks.jsx` | The workflow canvas: 14 typed nodes wired into a dot-grid surface, one run playing itself through them, and an inspector beside it showing the real payload in and out of whichever node you are looking at. |
| `src/components/Receipt.jsx` | The trust receipt that prints when the run finishes. |
| `src/components/Features.jsx` | Six claims, plus the honest "what OPX does not do yet" note. |
| `src/components/Footer.jsx` | `Pull the cable. Ask again.` plus the plate: mark, build credit, and the no-external-calls line. |
| `tailwind.config.js` | Every colour, with a comment saying what job it has. |
| `src/index.css` | The type treatment and the two-room background. |

`src/components/FenceWall.jsx` is still in the folder but **is not rendered** — it was the
egress-wall section (outbound calls racing at a line and being refused) and it was cut from
the page on 2026-09-01. Nothing imports it. Delete the file if you are sure, or re-add
`<FenceWall />` to `App.jsx` above `<HowItWorks />` to bring it back.

## The design in one paragraph

Two rooms with one line between them. Above the cut it is **paper** (`#EDF0EC`) — the plant
office, where note sheets and inspection reports live. Below the cut it is **plant**
(`#08090A`) — the machine room, where OPX actually runs. A 1px amber line marks the seam
along the bottom of the hero panel, and the same line turns up wherever the page needs to
report state: the wires filling in behind the run on the workflow canvas, and the very last
row of pixels on the page.

Amber `#FF8A2B` means *running*. Green `#57D98A` means *verified*. Red `#FF4D3D` means
*refused*. None of the three is ever used for decoration, which is why they still mean
something by the time you reach the footer. Amber's jobs: the `X` in the wordmark, the seam
under the hero, the wires behind the running node, the last line on the page, and the filled
**Enter** button — the way into OPX is the same colour in both rooms, so you never hunt for
it. That is the `enter` variant in `ui/button.jsx` and it is reserved for that one action;
amber on `#08090A` text clears 8:1 contrast, so it is safe as a filled button. Green marks
the two things a judge can check — the steps already behind the run, and the
no-external-calls line on the footer plate.

Corners are squared off but never sharp — 13px on the navbar bezel, 10px on controls, 16px
on the hero panel, and dead square on every panel in the machine room. Only status lights
stay round, because a light is round.

**One Tailwind gotcha:** slash opacity modifiers only work on multiples of five.
`bg-paper/92` and `border-ink/12` silently generate nothing at all, so the border or
background just disappears. Use `/90` and `/15`, or the bracket form `bg-paper/[0.92]`.

Five typefaces, one job each. **Chakra Petch** sets the OPX wordmark and nothing else —
squared and technical, like a plate stencilled onto a control panel, with the `X` in amber
because that is the same X the egress guard stamps on a blocked call. **Archivo** is pushed
out on its width axis to 108 for display type, so headlines read like a nameplate stamped
on equipment rather than a marketing headline. **IBM Plex Sans** is body copy and **IBM
Plex Mono** is anything that is data — tag numbers, log lines, labels, buttons, the
receipt. **Newsreader** italic appears exactly twice, under the punch line and beside the
Features heading; it is the one human voice on the page, and a third use would stop it
being a voice.

## The workflow canvas

`HowItWorks.jsx` is the one place on the page where the one-colour-one-job rule relaxes, and
it is deliberate. A node editor colours a workflow by what each node *is*, so you can read
the shape of a flow before reading a single label — so the canvas gets six extra hues under
the `node` group in `tailwind.config.js`: pink for the request that started it, blue for
logic, cyan for guards, violet for the model, teal for the file tools, green for output.
They exist for that section and are used nowhere else. Amber, green and red keep their usual
meanings on top: amber is the node running right now, green is a node the run is already
past, red is the branch nothing took.

The section is data, not markup. `NODES` holds all fourteen nodes with the copy for each —
`why` is the paragraph in the inspector, and `frames[]` is the payload, where `frames[0]` is
the first trip round the loop and `frames[1]` the second. `SCRIPT` is the playback order:
twenty-two beats at `BEAT` ms each, with `back: true` on the one beat that jumps from the end
of the loop back up to the model. Edit those two arrays and the whole diagram changes; there
is no layout to keep in sync.

Three things carry the argument. The **loop bracket** is the dashed rail in the left gutter:
the model is asked, the guards run, the result goes back in, and the model is asked again —
that is what makes this an agent rather than one API call, and it is why the drawing loops
instead of running straight down. The **four guard nodes** sit between the model's intent and
the file it wants, and every one of them has to return allow; a guard that throws counts as a
deny. The **refused spur** hanging off the egress guard is drawn dashed on purpose: it is
what *would* happen if anything in the process reached for the network, and it says
`attempts on this run: 0` rather than pretending a block happened.

Clicking any node pins it, which pauses the run so you can read; clicking it again — or the
`resume run` button in the inspector header — lets the run go. The canvas scrolls itself to
follow the active node, and it scrolls only its own box (measured with
`getBoundingClientRect()` deltas, not `offsetTop`, because the loop wrapper is
`position: relative` and would otherwise be the offset parent).


## Fonts and the offline demo

`index.html` loads all five families from Google Fonts. That is fine while you build,
but **the finale demo machine has no internet**, so the page would fall back to system
fonts on stage. Before the demo, download the five families, drop the `.woff2` files in
`public/fonts/`, add `@font-face` rules to `src/index.css`, and delete the Google Fonts
`<link>`. A landing page for an air-gapped product should not need the network either.

## Before you change the copy

Two claims on this page are worded carefully because the current backend earns exactly
these and not more:

- The receipt is described as **ordered and gap-checked**. It is not hashed, not a chain
  and not signed. Do not upgrade the wording to "tamper-proof".
- The Features section says OPX produces **text artifacts** today. Drawings and scanned
  reports are named as future work, not as a feature.

The punch line is **"Nothing leaves the room."** with *except the work.* underneath. The
turn is the whole point — the first line sounds like a restriction, the second says what
you get anyway. If you reword one, reword both.

The host and port (`127.0.0.1:8787`) are deliberately not printed anywhere on the page.
The console header shows the request line and an event counter instead.

The navbar carries no scroll-progress bar. There was an amber one under the bezel for a
while and it was removed on purpose — the page already has plenty of amber that reports
real state, and a line that only reports *how far you have scrolled* was the one piece of
it that meant nothing. Do not add it back.
