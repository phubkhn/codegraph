#!/usr/bin/env node
// Export a .codegraph/graph.db into a single self-contained HTML file
// (vis-network loaded from CDN) so the graph can be inspected visually
// in a browser. Usage:
//   node scripts/export-graph-html.mjs <project-root> [out.html]

import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const projectRoot = resolve(process.argv[2] ?? ".");
const outPath = resolve(process.argv[3] ?? "codegraph.html");
const dbPath = join(projectRoot, ".codegraph", "graph.db");

if (!existsSync(dbPath)) {
  console.error(`No graph found at ${dbPath}. Run "codegraph index" in ${projectRoot} first.`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const nodes = db.prepare("SELECT id, type, name, qualified_name, metadata FROM nodes").all();
const edges = db.prepare("SELECT source, target, type FROM edges").all();
db.close();

const COLORS = {
  FILE: "#9aa5b1",
  CLASS: "#4f8ef7",
  INTERFACE: "#7aa8ff",
  ENUM: "#a58bff",
  FUNCTION: "#4fbf7c",
  METHOD: "#2fae60",
  VARIABLE: "#c9c9c9",
  REST_ENDPOINT: "#f7a34f",
  REACT_COMPONENT: "#61dafb",
  REACT_HOOK: "#00b3a4",
  ENTITY: "#e0576a",
  KAFKA_TOPIC: "#000000",
  TEST: "#b8860b",
};

const visNodes = nodes.map((n) => ({
  id: n.id,
  label: n.name,
  title: `${n.type}\n${n.qualified_name}`,
  group: n.type,
  color: COLORS[n.type] ?? "#888",
}));

const visEdges = edges.map((e) => ({
  from: e.source,
  to: e.target,
  label: e.type,
  arrows: "to",
  font: { size: 8, align: "middle" },
  color: { color: "#888", opacity: 0.6 },
}));

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>CodeGraph — ${projectRoot}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  #toolbar { padding: 8px 12px; background: #1e1e1e; color: #eee; font-size: 13px; display: flex; gap: 12px; align-items: center; }
  #toolbar input { padding: 4px 8px; font-size: 13px; }
  #network { width: 100%; height: calc(100% - 40px); }
  .legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 3px; vertical-align: middle; }
</style>
</head>
<body>
<div id="toolbar">
  <strong>CodeGraph</strong> (${nodes.length} nodes / ${edges.length} edges)
  <input id="filter" placeholder="filter by name..." />
  <div class="legend">${Object.entries(COLORS).map(([t, c]) => `<span><span class="swatch" style="background:${c}"></span>${t}</span>`).join("")}</div>
</div>
<div id="network"></div>
<script>
  const allNodes = new vis.DataSet(${JSON.stringify(visNodes)});
  const allEdges = new vis.DataSet(${JSON.stringify(visEdges)});
  const container = document.getElementById("network");
  const data = { nodes: allNodes, edges: allEdges };
  const options = {
    nodes: { shape: "dot", size: 10, font: { size: 11 } },
    physics: { stabilization: true, barnesHut: { gravitationalConstant: -3000, springLength: 120 } },
    interaction: { hover: true, tooltipDelay: 100 },
  };
  const network = new vis.Network(container, data, options);

  document.getElementById("filter").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { allNodes.update(visNodes.map(n => ({ id: n.id, hidden: false }))); return; }
    allNodes.update(visNodes.map(n => ({ id: n.id, hidden: !n.label.toLowerCase().includes(q) })));
  });
</script>
</body>
</html>`;

writeFileSync(outPath, html, "utf8");
console.log(`Wrote ${outPath} (${nodes.length} nodes, ${edges.length} edges). Open it in a browser.`);
