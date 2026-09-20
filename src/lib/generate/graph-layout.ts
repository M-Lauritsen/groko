/**
 * Layered layout for the Resources dependency graph.
 * Topology comes only from collectDeps (Environment ref graph) — no second model.
 */

import type { ResourceInstance } from "../schema/types";
import { canReference } from "../schema/environments";
import { collectDeps, type DepEdge } from "./deps";

export interface GraphEdge extends DepEdge {
  /** False when cross-env (or otherwise blocked by canReference). */
  valid: boolean;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

const NODE_W = 168;
const NODE_H = 68;
const H_GAP = 48;
const V_GAP = 28;
const PAD = 32;

/**
 * Edges among `visible` resources, using the same collectDeps graph.
 * Cross-env-blocked refs are marked valid:false (caller may omit or dim).
 */
export function graphEdgesForVisible(
  visible: ResourceInstance[],
  allResources: ResourceInstance[]
): GraphEdge[] {
  const byId = new Map(allResources.map((r) => [r.id, r]));
  const visibleIds = new Set(visible.map((r) => r.id));
  const edges = collectDeps(allResources).filter(
    (e) => visibleIds.has(e.fromId) && visibleIds.has(e.toId)
  );
  return edges.map((e) => {
    const from = byId.get(e.fromId);
    const to = byId.get(e.toId);
    const valid = !!(from && to && canReference(from, to));
    return { ...e, valid };
  });
}

/** Longest-path layer (deps sink toward higher layers). Isolated → layer 0. */
function assignLayers(
  ids: string[],
  validEdges: GraphEdge[]
): Map<string, number> {
  const layer = new Map<string, number>();
  for (const id of ids) layer.set(id, 0);

  // Kahn-ish relaxation: edge from→to means from depends on to, so from is deeper.
  // We place targets (dependencies) left, dependents right.
  const preds = new Map<string, string[]>(); // toId <- fromIds that depend on it
  const succs = new Map<string, string[]>(); // fromId -> toIds it depends on
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const e of validEdges) {
    if (!layer.has(e.fromId) || !layer.has(e.toId)) continue;
    succs.get(e.fromId)!.push(e.toId);
    preds.get(e.toId)!.push(e.fromId);
  }

  // Layer(to) = 0 for roots (nothing depends… wait):
  // Convention: dependency targets on the left (layer 0), dependents to the right.
  // Edge from A → to B means A references B (A depends on B).
  // So B should be left of A: layer(B) < layer(A).
  let changed = true;
  let guard = 0;
  while (changed && guard < ids.length + 2) {
    changed = false;
    guard++;
    for (const e of validEdges) {
      const toL = layer.get(e.toId) ?? 0;
      const fromL = layer.get(e.fromId) ?? 0;
      if (fromL <= toL) {
        layer.set(e.fromId, toL + 1);
        changed = true;
      }
    }
  }
  return layer;
}

export function layoutDependencyGraph(
  visible: ResourceInstance[],
  allResources: ResourceInstance[],
  opts?: { omitInvalidEdges?: boolean }
): GraphLayout {
  const omitInvalid = opts?.omitInvalidEdges !== false;
  const allEdges = graphEdgesForVisible(visible, allResources);
  const drawEdges = omitInvalid
    ? allEdges.filter((e) => e.valid)
    : allEdges;

  const ids = visible.map((r) => r.id);
  const layers = assignLayers(
    ids,
    allEdges.filter((e) => e.valid)
  );

  const byLayer = new Map<number, string[]>();
  let maxLayer = 0;
  for (const id of ids) {
    const L = layers.get(id) ?? 0;
    maxLayer = Math.max(maxLayer, L);
    if (!byLayer.has(L)) byLayer.set(L, []);
    byLayer.get(L)!.push(id);
  }

  // Stable order within layer: original visible order
  const orderIndex = new Map(ids.map((id, i) => [id, i]));
  for (const [, group] of byLayer) {
    group.sort((a, b) => (orderIndex.get(a)! - orderIndex.get(b)!));
  }

  const nodes: LayoutNode[] = [];
  let maxY = 0;
  for (let L = 0; L <= maxLayer; L++) {
    const group = byLayer.get(L) ?? [];
    group.forEach((id, row) => {
      const x = PAD + L * (NODE_W + H_GAP);
      const y = PAD + row * (NODE_H + V_GAP);
      nodes.push({
        id,
        x,
        y,
        width: NODE_W,
        height: NODE_H,
        layer: L,
      });
      maxY = Math.max(maxY, y + NODE_H);
    });
  }

  const width = PAD * 2 + (maxLayer + 1) * NODE_W + maxLayer * H_GAP;
  const height = Math.max(PAD * 2 + NODE_H, maxY + PAD);

  return { nodes, edges: drawEdges, width, height };
}

export const GRAPH_NODE_SIZE = { width: NODE_W, height: NODE_H };
