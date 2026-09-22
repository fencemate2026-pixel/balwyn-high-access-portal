import { Router } from "express";
import { createHireBooking, listHireBookings } from "../controllers/hiringController.ts";
import { asyncHandler } from "../middleware/errorHandler.ts";

export const hireRouter = Router();

hireRouter.get("/", asyncHandler(listHireBookings));
hireRouter.post("/", asyncHandler(createHireBooking));
