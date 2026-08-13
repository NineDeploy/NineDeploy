/** A typed HTTP error. The global error handler turns it into the API error envelope. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (message = 'Bad request', code = 'bad_request') =>
  new HttpError(400, code, message);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message = 'Conflict') => new HttpError(409, 'conflict', message);
