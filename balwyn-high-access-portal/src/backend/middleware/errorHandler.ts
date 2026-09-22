import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = "server_error",
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const asyncHandler = <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(handler: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  console.error("Unexpected portal error", error);
  res.status(500).json({
    error: {
      code: "server_error",
      message: "Unexpected server error.",
    },
  });
}
