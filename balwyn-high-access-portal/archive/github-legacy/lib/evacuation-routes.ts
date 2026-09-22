import type { ExitAssessment, FloorPlan, RoutePlan } from "@/lib/portal-types";

const routeCache = new Map<string, RoutePlan>();

function makeCacheKey(floorPlan: FloorPlan, incidentLocation: string) {
  return `${floorPlan.id}:${incidentLocation.trim().toLowerCase()}`;
}

function buildAdjacency(floorPlan: FloorPlan, blockedNodes: Set<string>) {
  const adjacency = new Map<string, string[]>();

  for (const node of floorPlan.nodes) {
    if (!blockedNodes.has(node.id)) adjacency.set(node.id, []);
  }

  for (const edge of floorPlan.edges) {
    if (edge.blocked) continue;
    if (blockedNodes.has(edge.from) || blockedNodes.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  return adjacency;
}

function shortestPath(
  adjacency: Map<string, string[]>,
  start: string,
  destination: string,
) {
  if (!adjacency.has(start) || !adjacency.has(destination)) return null;

  const queue: string[][] = [[start]];
  const visited = new Set([start]);

  while (queue.length) {
    const path = queue.shift();
    const current = path?.at(-1);
    if (!path || !current) continue;
    if (current === destination) return path;

    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push([...path, next]);
    }
  }

  return null;
}

function resolveBlockedNodes(floorPlan: FloorPlan, incidentLocation: string) {
  const location = incidentLocation.trim().toLowerCase();
  const matchingNode = floorPlan.nodes.find(
    (node) => node.label.toLowerCase() === location || node.id === location,
  );

  return new Set<string>(matchingNode ? [matchingNode.id] : []);
}

export function calculateEvacuationRoutes(
  floorPlan: FloorPlan,
  incidentLocation: string,
): RoutePlan {
  const cacheKey = makeCacheKey(floorPlan, incidentLocation);
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;

  const blockedNodes = resolveBlockedNodes(floorPlan, incidentLocation);
  const adjacency = buildAdjacency(floorPlan, blockedNodes);
  const exits = floorPlan.nodes.filter((node) => node.kind === "exit");

  const routes = floorPlan.nodes
    .filter((node) => node.kind === "classroom")
    .map((classroom) => {
      if (blockedNodes.has(classroom.id)) {
        return {
          classroomId: classroom.id,
          classroom: classroom.label,
          exitId: null,
          exitLabel: "No safe exit available",
          path: [classroom.label],
          advisory: "Incident intersects this room. Hold position and await direct operator instruction.",
          status: "blocked" as const,
        };
      }

      const candidatePaths = exits
        .map((exit) => ({ exit, path: shortestPath(adjacency, classroom.id, exit.id) }))
        .filter((candidate) => candidate.path)
        .sort((left, right) => (left.path?.length ?? 999) - (right.path?.length ?? 999));

      const best = candidatePaths[0];
      if (!best?.path) {
        return {
          classroomId: classroom.id,
          classroom: classroom.label,
          exitId: null,
          exitLabel: "No safe exit available",
          path: [classroom.label],
          advisory: "No advisory route available. Escalate to local warden review.",
          status: "blocked" as const,
        };
      }

      return {
        classroomId: classroom.id,
        classroom: classroom.label,
        exitId: best.exit.id,
        exitLabel: best.exit.label,
        path: best.path.map(
          (nodeId) =>
            floorPlan.nodes.find((node) => node.id === nodeId)?.label ?? nodeId,
        ),
        advisory: `Advisory only. Route ${classroom.label} to ${best.exit.label} for human review before broadcast.`,
        status: "safe" as const,
      };
    });

  const exitsAssessment: ExitAssessment[] = exits.map((exit) => {
    const inUse = routes.some((route) => route.exitId === exit.id && route.status === "safe");
    return {
      exitId: exit.id,
      label: exit.label,
      status: inUse ? "safe" : "blocked",
      reason: inUse
        ? "Available for reviewed advisory routing."
        : "No safe classroom route reaches this exit from the current incident area.",
    };
  });

  const plan: RoutePlan = {
    incidentLocation,
    generatedAt: new Date().toISOString(),
    advisoryOnly: true,
    humanReviewed: false,
    routes,
    exits: exitsAssessment,
  };

  routeCache.set(cacheKey, plan);
  return plan;
}

export function markRoutePlanReviewed(plan: RoutePlan): RoutePlan {
  return { ...plan, humanReviewed: true };
}
