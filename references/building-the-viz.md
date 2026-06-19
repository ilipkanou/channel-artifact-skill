# Building the viz layer

Reference material for Step 3 (pick a library) and the worked examples. The comment plumbing is already done by the template — this is only about painting `DATA` into the DOM.

## Libraries worth knowing

No runtime dependencies are required — the template is vanilla JS + Bun. Pull in only what you need via ESM CDN imports (`https://cdn.jsdelivr.net/npm/<pkg>@<version>/+esm`). Pick based on the artifact shape:

| Need | Library | Notes |
|---|---|---|
| Any data viz | **D3 v7** | The Swiss Army knife. `d3-sankey`, `d3-scale`, `d3-shape`, `d3-force` etc. are all available. **Gotcha**: d3-sankey 0.12 UMD is broken on d3 v7 — use ESM and spread the frozen namespace. See `troubleshooting.md`. |
| Declarative charts | **Chart.js** / **Plotly.js** / **ApexCharts** | Chart.js is lightest; Plotly supports more chart types; ApexCharts is the prettiest out of the box. |
| Grammar-of-graphics | **Observable Plot** | `@observablehq/plot` — built on D3, much less ceremony. Great for quick analytical viz. |
| Network / graph editors | **Cytoscape.js** / **Sigma.js** / **vis-network** | Cytoscape if you need styling power; Sigma for very large graphs; vis-network for quick wins. |
| Canvas / interactive 2D | **Konva.js** / **Fabric.js** / **Pixi.js** | Konva is most ergonomic for "shapes you can drag around". Pixi is best for perf-critical cases. |
| 3D / WebGL | **Three.js** / **regl** | Three.js for scenes; regl for pure shader work. |
| Flow diagrams | **Mermaid.js** / **React Flow** / **@xyflow/react** | Mermaid is zero-config but read-only; React Flow lets users drag nodes. |
| Maps | **Leaflet** / **MapLibre GL** | Leaflet is the simplest; MapLibre is vector + GPU. |
| Tables | **Tabulator** / **AG Grid (community)** | Tabulator for ergonomics; AG Grid for scale. |
| Code editors | **CodeMirror 6** / **Monaco** | CodeMirror ships lighter; Monaco is VS Code's editor verbatim. |
| Markdown | **marked** / **markdown-it** | Both fine; marked is smaller. |
| State | **Nanostores** / **Zustand** | Only if vanilla JS state becomes unmanageable. Most artifacts don't need this. |
| Animation | **Motion One** / **GSAP** | Motion One is tiny and web-native. GSAP for timeline-style animation. |
| Icons | **Lucide** / **Heroicons** / emoji | Inline SVG is fastest; Lucide has a clean aesthetic. |

For styling: plain CSS works. If you want utility-first, use Tailwind via the CDN JIT (`https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4`). Skip it if the artifact is small — the template already has a clean design-system.

## Example walk-throughs

### Walk-through A: "A kanban board I can pin comments on"

1. **Interview** — kanban columns are "Todo / In Progress / Done". Each card has `id`, `title`, `description`. No external data source; user will add cards by hand. No redaction. Plugin name: `kanban`.
2. **Scaffold** — copy templates, name everything `kanban`.
3. **`data.json`** — `{ "columns": [{ "id": "todo", "title": "Todo", "cards": [] }, ...] }`.
4. **`renderArtifact`** — paint three columns, each card rendered as a `<div data-node-id="card_<id>">`. Columns themselves get `data-node-id="col_<id>"`.
5. **Tools** — add `add_card(column_id, title, description)` and `move_card(card_id, to_column_id)` tool handlers alongside `mark_addressed`. Update `server.ts` tool list + CallToolRequestSchema switch.
6. **Instructions field** — tell Claude: comments anchored to a card are feedback on that card; comments on a column are feedback on the column strategy; freeform comments might be general product questions.
7. **Launch instructions** — standard block.

### Walk-through B: "A graph editor for my data model"

1. **Interview** — nodes are tables, edges are foreign keys. Data comes from the user's Prisma schema (read via file system). User wants to pin comments on tables/columns to ask "why is this indexed?" etc.
2. **Scaffold** — plugin name: `schema-explorer`.
3. **Library** — Cytoscape.js (drag/zoom included) or React Flow.
4. **`data.json`** — `{ "tables": [{ "id": "User", "columns": [...], "x": 100, "y": 50 }], "edges": [...] }`. Initial positions via a force layout on first render.
5. **Pre-populate** — before launching, read `prisma/schema.prisma` and bake the graph into `data.json`.
6. **Tools** — `mark_addressed`, `update_node` (to reposition a table), `add_note(node_id, text)` to attach Claude's insight as a sticky note rendered on the table card.
7. **Instructions field** — tell Claude: comments on a table are schema questions; comments on an edge are foreign-key questions; freeform with a context_snippet of "relationship" is about overall data model.

### Walk-through C: "An image annotator where I ask Claude about regions"

1. **Interview** — user drops an image path; wants to click regions and ask Claude questions about them (OCR, object description, etc.).
2. **Scaffold** — plugin name: `image-annotator`.
3. **`data.json`** — `{ "imagePath": "/path/to/image.png", "regions": [] }`.
4. **`renderArtifact`** — render the image; overlay a canvas for clicks; freeform pin coordinates directly encode the region of interest.
5. **Tools** — `mark_addressed` is all you need (regions ARE the comments, since every click is a freeform pin at (x,y)).
6. **Extra** — in Claude's instructions, tell it to crop the region from the image (via the Read tool on the file with offset/region) to answer accurately.
