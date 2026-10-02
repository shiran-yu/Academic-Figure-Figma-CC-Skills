# Parallel drawing protocol

`use_figma` calls are stateless and the MCP server accepts concurrent calls, so
independent regions of a figure can be drawn simultaneously. This is the main
wall-clock lever: a 5-stage figure drops from ~8 sequential round trips to ~4 waves.

## Safety condition

Two calls may run in parallel **iff they write into disjoint subtrees whose parent
frames already exist and whose ids are known**, and neither performs global layout
(artboard resize, arrow re-centring, panel shifting).

## The wave pattern

```
Wave 1  (serial, 1 call):   artboard + all stage/panel containers -> return ALL ids
Wave 2  (parallel, N calls): one call per container, fill content by id
                             — emit the N use_figma blocks in ONE message
Wave 3  (serial, 1 call):   arrows, legend, global balance, artboard trim
Wave 4  (serial, 1 call):   screenshot + fix list; small fixes may again fan out
```

Emit Wave-2 calls as multiple tool-use blocks in a single assistant message — they
execute concurrently. Do NOT await one before issuing the next.

Each Wave-2 call must:
- start with the line `//@figma_lib` (the PreToolUse hook expands it into figma_lib.js; context
  is per-call) followed by `await FONTS()`. If a call fails because the marker reached Figma
  unexpanded, the hook is not loaded: paste the lib as before;
- target ONLY its own container id;
- avoid touching the artboard, siblings, or anything global;
- return its created ids so Wave 3 can reference them.

## Rate-limit budget

Full seat quotas are 200/day and 10-15 calls/min. A 5-wide fan-out is safe;
if a burst error returns, halve the fan-out width and continue — do not retry
in a tight loop.

## Multi-agent variant (large figures / Workflow tool)

For multi-panel figures (or several figures in one session) the same protocol runs
one **agent per panel**: give each agent the panel's container id, the spec for that
panel only, and require it to stay inside its subtree. MCP tools are reachable from
subagents via ToolSearch. Reserve this for genuinely big jobs — for a single figure,
same-message fan-out is simpler and just as fast.

## What must stay serial

- Anything that resizes the artboard or moves containers (Waves 1/3 only).
- Arrow placement across containers (needs final positions).
- The divider/legend (global elements).
- Screenshot review (needs everything landed).
