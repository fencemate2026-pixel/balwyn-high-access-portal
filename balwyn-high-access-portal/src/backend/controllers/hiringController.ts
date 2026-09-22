import crypto from "crypto";
import type { Request, Response } from "express";
import type { HireBooking } from "../../shared/types.ts";
import { database } from "../services/database.ts";

export async function listHireBookings(_req: Request, res: Response): Promise<void> {
  res.json({ data: await database.getHireBookings() });
}

export async function createHireBooking(req: Request, res: Response): Promise<void> {
  const payload = req.body as Omit<HireBooking, "id" | "status"> & Partial<Pick<HireBooking, "status">>;
  const booking: HireBooking = {
    id: crypto.randomUUID(),
    status: payload.status ?? "pending",
    organisation: payload.organisation,
    contactName: payload.contactName,
    location: payload.location,
    startIso: payload.startIso,
    endIso: payload.endIso,
    expectedAttendance: payload.expectedAttendance,
  };
  res.status(201).json({ data: await database.createHireBooking(booking) });
}
