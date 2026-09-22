import type { Request, Response } from "express";
import { database } from "../services/database.ts";

export async function getAccessRules(_req: Request, res: Response): Promise<void> {
  res.json({ data: await database.getRules() });
}

export async function evaluateAccess(req: Request, res: Response): Promise<void> {
  const payload = req.body as { gateId: string; credentialGroup: string };
  const decision = await database.evaluateAccess(payload.gateId, payload.credentialGroup);
  res.json({ data: decision });
}
