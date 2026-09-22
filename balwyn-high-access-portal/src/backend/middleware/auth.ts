import type { NextFunction, Request, Response } from "express";
import type { OperatorContext } from "../models/types.ts";

declare global {
  namespace Express {
    interface Request {
      operator?: OperatorContext;
    }
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.operator = {
    id: req.header("x-operator-id") ?? "operator-001",
    role: req.header("x-portal-role") ?? "admin",
    name: req.header("x-operator-name") ?? "Magic Keys Operator",
  };
  next();
}
