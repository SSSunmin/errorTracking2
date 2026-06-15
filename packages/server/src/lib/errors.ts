export type ErrorDetails = Record<string, unknown> | readonly unknown[];

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ErrorDetails;

  public constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: ErrorDetails
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export const badRequest = (message: string, details?: ErrorDetails): HttpError =>
  new HttpError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "Unauthorized"): HttpError =>
  new HttpError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Forbidden"): HttpError =>
  new HttpError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found"): HttpError =>
  new HttpError(404, "NOT_FOUND", message);

export const conflict = (message: string): HttpError =>
  new HttpError(409, "CONFLICT", message);
