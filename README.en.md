<p align="center">
  <img src="assets/Logo.png" width="160" alt="logo">
</p>

<h1 align="center">Academic-Figure-Figma-CC-Skills</h1>

<p align="center"><b>The last mile of the academic figure toolchain.</b></p>

<p align="center">
  <a href="https://github.com/shiran-yu/Academic-Figure-Figma-CC-Skills/stargazers"><img src="https://img.shields.io/github/stars/shiran-yu/Academic-Figure-Figma-CC-Skills?style=flat-square&logo=github" alt="stars"></a>
  <a href="https://github.com/shiran-yu/Academic-Figure-Figma-CC-Skills/network/members"><img src="https://img.shields.io/github/forks/shiran-yu/Academic-Figure-Figma-CC-Skills?style=flat-square&logo=github" alt="forks"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-Skill-D97757?style=flat-square" alt="Claude Code Skill">
  <img src="https://img.shields.io/badge/Figma-MCP-F24E1E?style=flat-square&logo=figma&logoColor=white" alt="Figma MCP">
</p>

<p align="center">English · <a href="README.md">中文</a></p>

---

Upstream figure pipelines ([studio-pro](https://github.com/c-narcissus/paper-framework-figure-studio-pro), [PaperBanana](https://github.com/llmsresearch/paperbanana)) produce raster candidates — great for exploring layout, impossible to hand-tune. This skill lets **Claude Code drive Figma directly through the official Figma MCP server**, landing a candidate or sketch as the final **editable, paper-exact vector figure**: true print width, true vector icons, every label audited against the paper source.

## 🎬 Live demo

<!-- VIDEO_EMBED_EN -->
<p align="center">
  <img src="assets/demo.gif" width="880" alt="Claude Code driving Figma to draw a paper figure">
</p>

<p align="center"><sub>Left: the Figma canvas filling in live · Right: Claude Code driving it (6x speed) · <a href="assets/demo.mp4">full-speed mp4 (2:31)</a></sub></p>

No human intervention: skeleton → three parallel fill calls → one assembly pass laying 25 end-to-end arrows → screenshot self-review, which caught two memory arrows piercing the cross-attention block and rerouted them.

## 📰 News

> - **2026-08** · v0.6: extract_palette.py reference-colour extraction — per-component fill/stroke/text trio via crop, point probes; colours are measured before drawing, never guessed.
> - **2026-08** · v0.5: auditFigure() structured figure lint — font floor, ink overflow, block overlap, arrow-through-block, buried heads; verified against seeded defects on a real canvas.
> - **2026-08** · v0.4: single-node end-to-end arrows, STYLE tokens + consistency audit, latex2svg formula pipeline, parallel drawing protocol, live demo video.
> - **2026-08** · v0.1 released: five-step workflow + five reference docs + login-free iconfont search script.

## 📦 Skill structure

```
academic-figure-figma/
├── SKILL.md          # hard rules + five-step workflow
├── references/       # detail docs, loaded on demand
└── scripts/          # executable tools
```

| File | What it covers |
| --- | --- |
| `SKILL.md` | 8 hard rules; Preflight → skeleton → parallel fill → assembly → review loop |
| `references/figma-api-cheatsheet.md` | Self-contained API subset: single-node arrows, STYLE tokens, consistency discipline, error→fix table |
| `references/parallel-drawing.md` | Parallel drawing protocol: safety condition and wave pattern for same-message fan-out |
| `references/figma-mcp-setup.md` | MCP connection, OAuth on remote sessions, seat/quota traps, free Education plan (200 calls/day) |
| `references/paper-canvas-specs.md` | IEEEtran 252/516pt, elsarticle ≈390pt, AAAI 239/504pt, 6pt font floor, Tinos for Times |
| `references/figure-grammar.md` | Figure grammar: arrow evidence, no false relays, variables on edges, centred mainline, anti-AI palette |
| `references/figure-styles.md` | Academic figure styling: 6 named presets (Nature / IEEE / ML pastel-block / Tol…), palette construction rules, sampler-board + hex-map restyle workflow |
| `references/icon-sourcing.md` | Lucide / lobe-icons / simpleicons / iconfont API vector sourcing with per-mark verification |
| `references/build-workflow.md` | Incremental build, multi-column balancing, screenshot checklist, recorded pitfalls |
| `scripts/figma_lib.js` | Battle-tested drawing library: single-node end-to-end arrows, stageColumn/chip/brace, auditFigure structured lint |
| `scripts/latex2svg.py` | LaTeX → STIX (Times-style) → injectable SVG formula pipeline |
| `scripts/extract_palette.py` | Reference-image colours: per-component crop (fill/stroke/text trio), point probes, global palette (background dropped before quantizing) |
| `scripts/iconfont_search.py` | iconfont.cn login-free search → injectable SVG |
| `scripts/assets/icons/` | 32 pre-cleaned cached icons (24 Lucide + 8 AI brand marks, each eye-verified) |

## 🚀 Quick start

```bash
git clone https://github.com/shiran-yu/Academic-Figure-Figma-CC-Skills.git
cp -r Academic-Figure-Figma-CC-Skills/academic-figure-figma ~/.claude/skills/
claude plugin install figma@claude-plugins-official   # OAuth steps: references/figma-mcp-setup.md
```

Then ask Claude Code: **"Rebuild this framework figure in Figma at IEEE double-column width."**

## 🙏 Acknowledgements

[paper-framework-figure-studio-pro](https://github.com/c-narcissus/paper-framework-figure-studio-pro) (figure grammar distilled from its S1/S4 prompt contracts) · [PaperBanana](https://github.com/llmsresearch/paperbanana) · [academic-figure-generator](https://github.com/LigphiDonk/academic-figure-generator) · the official Figma MCP plugin
