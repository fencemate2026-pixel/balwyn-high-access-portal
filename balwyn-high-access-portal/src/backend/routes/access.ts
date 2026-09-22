import { Router } from "express";
import { evaluateAccess, getAccessRules } from "../controllers/accessControl.ts";
import { asyncHandler } from "../middleware/errorHandler.ts";

export const accessRouter = Router();

accessRouter.get("/rules", asyncHandler(getAccessRules));
accessRouter.post("/evaluate", asyncHandler(evaluateAccess));
