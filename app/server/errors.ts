export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: unknown = {}) { super(message); }
}
export const notFound = (what = "resource") => new ApiError(404, "not_found", `${what} not found`);
export const validation = (message: string, details: unknown = {}) => new ApiError(422, "validation", message, details);
