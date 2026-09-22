import type { Request, Response } from "express";
import { AppError } from "../middleware/errorHandler.ts";
import { database } from "../services/database.ts";
import { buildHardwareCommand, dispatchHardwareCommand } from "../services/hardwareComm.ts";

export async function listGates(_req: Request, res: Response): Promise<void> {
  res.json({ data: await database.getGates() });
}

export async function commandGate(req: Request, res: Response): Promise<void> {
  const gateId = Array.isArray(req.params.gateId) ? req.params.gateId[0] : req.params.gateId;
  const action = (req.body as { action?: "open" | "lock" }).action ?? "lock";
  const gates = await database.getGates();
  const gate = gates.find((entry) => entry.id === gateId);
  if (!gate) {
    throw new AppError("Gate not found", 404, "not_found");
  }
  const command = buildHardwareCommand(gateId, gate.relayChannel, action);
  await dispatchHardwareCommand(command);
  const updated = await database.updateGate(gateId, action);
  res.json({ data: updated, meta: { checksum: command.checksum } });
}

export async function getEmergencyState(_req: Request, res: Response): Promise<void> {
  res.json({ data: await database.getEmergency() });
}

export async function setEmergencyState(req: Request, res: Response): Promise<void> {
  const payload = req.body as { action: "lockdown" | "fire" | "normal" };
  const operator = req.operator?.name ?? "Magic Keys Operator";
  res.json({ data: await database.setEmergency(payload.action, operator) });
}
