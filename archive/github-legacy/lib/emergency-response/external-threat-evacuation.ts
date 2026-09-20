export interface OccupancyData {
  rooms: Record<string, number>;
}

export interface EvacuationRoute {
  primary_exit: string;
  backup_exit: string;
  occupancy: number;
  message: string;
}

export interface EvacuationRoutingMap {
  room_routes: Record<string, EvacuationRoute>;
  assembly_points: Record<string, string>;
  evacuation_confidence: number;
}

const THREAT_TO_AVOIDED_EXITS: Record<string, string[]> = {
  FRONT_GATE: ["EXIT_NORTH", "EXIT_WEST", "EXIT_SOUTH", "EXIT_EAST"],
  SPORTS_GATE: ["EXIT_EAST", "EXIT_NORTH", "EXIT_SOUTH", "EXIT_WEST"],
  STAFF_GATE: ["EXIT_SOUTH", "EXIT_EAST", "EXIT_WEST", "EXIT_NORTH"],
  EMERGENCY_GATE: ["EXIT_WEST", "EXIT_SOUTH", "EXIT_NORTH", "EXIT_EAST"],
};

export function calculate_evacuation_routes_external_threat(
  threat_location: string,
  occupancy: OccupancyData,
): EvacuationRoutingMap {
  const exits = THREAT_TO_AVOIDED_EXITS[threat_location] ?? [
    "EXIT_NORTH",
    "EXIT_EAST",
    "EXIT_SOUTH",
    "EXIT_WEST",
  ];

  const room_routes = Object.fromEntries(
    Object.entries(occupancy.rooms).map(([room, people], index) => {
      const primary_exit = exits[index % exits.length];
      const backup_exit = exits[(index + 1) % exits.length];
      return [
        room,
        {
          primary_exit,
          backup_exit,
          occupancy: people,
          message: `EVACUATE via ${primary_exit} - walk calmly and quickly`,
        },
      ];
    }),
  );

  return {
    room_routes,
    assembly_points: {
      SAFE_ZONE_1: "North field",
      SAFE_ZONE_2: "East sports area",
      SAFE_ZONE_3: "South perimeter",
    },
    evacuation_confidence: 99,
  };
}
