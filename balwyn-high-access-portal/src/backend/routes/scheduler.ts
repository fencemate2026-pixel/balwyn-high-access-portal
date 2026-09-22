import { Router } from "express";
import { getDashboard, listSchedules, saveSchedule } from "../controllers/scheduler.ts";
import { asyncHandler } from "../middleware/errorHandler.ts";

export const schedulerRouter = Router();

schedulerRouter.get("/dashboard", asyncHandler(getDashboard));
schedulerRouter.get("/rules", asyncHandler(listSchedules));
schedulerRouter.post("/rules", asyncHandler(saveSchedule));
