import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.ts";
import { database } from "../services/database.ts";
import { buildInsights } from "../services/aiEngine.ts";

export const aiRouter = Router();

aiRouter.get("/insights", asyncHandler(async (_req, res) => {
  const snapshot = await database.getSnapshot();
  res.json({ data: buildInsights(snapshot.gates, snapshot.schedules, snapshot.weather) });
}));

aiRouter.get("/weather", asyncHandler(async (_req, res) => {
  const snapshot = await database.getSnapshot();
  res.json({ data: snapshot.weather });
}));
