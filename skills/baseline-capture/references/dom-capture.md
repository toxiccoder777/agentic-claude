# Capturing DOM/render fingerprints into NDJSON

For `verification-gate`'s `visual` gate. The point of a fingerprint capture over a screenshot is that
it survives antialiasing and font-rendering differences between machines while still catching a real
layout or style regression — but only if you capture the right *kind* of fact.

## What to capture per element (or per view, aggregated)

Structural and computed-style facts, not pixels:

```json
{"view": "/checkout", "elementCount": 47, "geometry": "412x88@0,120", "color": "rgb(17,17,17)", "backgroundColor": "rgb(255,255,255)", "fontFamily": "Inter", "fontSize": "16px", "fontWeight": "400", "display": "flex"}
```

Getting each of these from a headless browser is usually one `getComputedStyle` call plus
`getBoundingClientRect` per element you care about — this reference is about what to do with the
result, not the browser automation itself.

## Field-by-field guidance

- **`view`** (the key) — the route or component identity, not a screenshot filename with a build
  number or timestamp baked in.
- **`geometry`** — round to whole pixels (or your project's meaningful tolerance) before capture, not
  compare. Sub-pixel layout jitter between runs on the same machine is common and meaningless; capture
  it pre-rounded so the gate never has to guess a tolerance.
- **`elementCount`** — a cheap, powerful signal. A component silently failing to render (an error
  boundary swallowing an exception, a conditional that stopped matching) often shows up first as a
  changed element count, before anything else does.
- **Colors** — capture the browser's own computed/resolved value (`rgb(17, 17, 17)`), never the
  source CSS token (`var(--text-primary)`) — the token can resolve differently in different themes or
  builds, and comparing resolved values is what actually catches "the theme silently changed."
- **Do not capture** anything that depends on real content that will legitimately differ between
  environments — user names, dates, counts pulled from live data. Seed a fixed, deterministic dataset
  for capture, or the `visual` gate's `compare` fields will report every content difference as a style
  regression.

## Animation and transient state

A capture taken mid-animation, mid-transition, or during a loading-spinner frame will never match a
capture taken a moment later or earlier — not because anything regressed, but because you captured two
different frames of the same correct behavior. Either capture after animations settle (wait for a
`transitionend`/`animationend` event, or a fixed settle delay long enough for your slowest transition)
or explicitly exclude animated properties from `compare` for those views. Don't discover this by
staring at flaky gate output — decide it up front and note it in the capture script's comments.

## Before freezing

Run `idempotency-check.mjs` against the same fixed dataset and viewport, twice. A capture that hasn't
waited out an animation, or that's pulling from unseeded live data, will show up as flaky here before
it ever reaches a gate run — which is a far cheaper place to find it.
