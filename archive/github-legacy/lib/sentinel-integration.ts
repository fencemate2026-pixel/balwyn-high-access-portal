import type { FloorPlan } from "@/lib/portal-types";

export const syntheticSentinelLayout: FloorPlan = {
  id: "sg-pro-sentinel-balwyn-synthetic",
  name: "sg-pro-sentinel synthetic lower-ground layout",
  nodes: [
    { id: "classroom-a1", label: "Classroom A1", kind: "classroom" },
    { id: "classroom-a2", label: "Classroom A2", kind: "classroom" },
    { id: "science-lab", label: "Science Lab", kind: "classroom" },
    { id: "library", label: "Library", kind: "classroom" },
    { id: "north-corridor", label: "North Corridor", kind: "junction" },
    { id: "south-corridor", label: "South Corridor", kind: "junction" },
    { id: "assembly-link", label: "Assembly Link", kind: "junction" },
    { id: "exit-north", label: "North Gate Exit", kind: "exit" },
    { id: "exit-south", label: "South Oval Exit", kind: "exit" },
    { id: "exit-east", label: "East Visitor Exit", kind: "exit" },
  ],
  edges: [
    { from: "classroom-a1", to: "north-corridor" },
    { from: "classroom-a2", to: "north-corridor" },
    { from: "science-lab", to: "south-corridor" },
    { from: "library", to: "assembly-link" },
    { from: "north-corridor", to: "assembly-link" },
    { from: "south-corridor", to: "assembly-link" },
    { from: "north-corridor", to: "exit-north" },
    { from: "south-corridor", to: "exit-south" },
    { from: "assembly-link", to: "exit-east" },
  ],
};

export const sentinelIncidentLocations = syntheticSentinelLayout.nodes
  .filter((node) => node.kind !== "exit")
  .map((node) => node.label);

export function loadSentinelFloorPlan() {
  return structuredClone(syntheticSentinelLayout);
}
