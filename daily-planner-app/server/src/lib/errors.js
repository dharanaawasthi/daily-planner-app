/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Task not found') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
