/**
 * Lives apart from `api.ts` so the auth backends can throw it without importing the
 * module that imports them.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
