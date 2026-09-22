import { Router } from "express";
import { commandGate, getEmergencyState, listGates, setEmergencyState } from "../controllers/gateControl.ts";
import { asyncHandler } from "../middleware/errorHandler.ts";

export const gatesRouter = Router();

gatesRouter.get("/", asyncHandler(listGates));
gatesRouter.post("/:gateId/command", asyncHandler(commandGate));
gatesRouter.get("/emergency", asyncHandler(getEmergencyState));
gatesRouter.post("/emergency", asyncHandler(setEmergencyState));
