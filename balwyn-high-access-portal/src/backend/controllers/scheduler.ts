import type { Request, Response } from "express";
import type { ScheduleRule } from "../../shared/types.ts";
import { database } from "../services/database.ts";
import { buildDashboard, nextSchedules } from "../services/schedulerEngine.ts";

export async function getDashboard(_req: Request, res: Response): Promise<void> {
  const gates = await database.getGates();
  const schedules = await database.getSchedules();
  res.json({ data: buildDashboard(gates, schedules) });
}

export async function listSchedules(_req: Request, res: Response): Promise<void> {
  const schedules = await database.getSchedules();
  res.json({ data: nextSchedules(schedules) });
}

export async function saveSchedule(req: Request, res: Response): Promise<void> {
  const schedule = req.body as ScheduleRule;
  res.status(201).json({ data: await database.upsertSchedule(schedule) });
}
