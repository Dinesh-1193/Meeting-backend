import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
  }
}

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError("Not found", 404));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      message: err.message,
      error: err.message,
      statusCode: err.status,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  console.error(err);
  const message =
    err instanceof Error ? err.message : "Internal server error";
  return res.status(500).json({
    message,
    error: message,
    statusCode: 500,
  });
}
