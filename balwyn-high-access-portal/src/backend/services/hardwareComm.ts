import crypto from "crypto";
import type { HardwareCommand } from "../../shared/types.ts";

const HARDWARE_ENDPOINT = process.env.HARDWARE_ENDPOINT;

export function buildHardwareCommand(gateId: string, relayChannel: number, command: HardwareCommand["command"]): HardwareCommand {
  const createdAt = new Date().toISOString();
  const checksum = crypto.createHash("sha256").update(`${gateId}:${relayChannel}:${command}:${createdAt}`).digest("hex").slice(0, 12);
  return { gateId, relayChannel, command, checksum, createdAt };
}

export async function dispatchHardwareCommand(command: HardwareCommand): Promise<{ delivered: boolean; transport: string }> {
  if (!HARDWARE_ENDPOINT) {
    return { delivered: true, transport: "simulated-pi-adapter" };
  }

  const response = await fetch(HARDWARE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocol: "ACB-004-relay-bridge", version: 1, command }),
  });

  if (!response.ok) {
    throw new Error(`Hardware bridge rejected command: ${response.status}`);
  }

  return { delivered: true, transport: HARDWARE_ENDPOINT };
}
