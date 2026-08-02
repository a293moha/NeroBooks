import { useCallback } from "react";
import { useAuth } from "../context/AuthContext";

/**
 * Thrown for every non-2xx response, with a message safe to show directly
 * in the UI (server error bodies are already stripped of stack traces —
 * see server/src/middleware/errorHandler.ts — this just adds a friendlier
 * fallback for the handful of status codes the whole app needs to react to
 * consistently: expired session, no access, not found, conflict, invalid
 * input).
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // Response body wasn't JSON — fall through to a generic message below.
  }
  switch (res.status) {
    case 401:
      return "Your session has expired. Please sign in again.";
    case 403:
      return "You don't have access to do that.";
    case 404:
      return "That item could not be found.";
    case 409:
      return "That couldn't be completed because something else changed first.";
    case 422:
      return "That request couldn't be processed.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * The one place the frontend talks to the Railway API. There is
 * deliberately no localStorage fallback anywhere in here — a failed
 * request surfaces as a thrown ApiError for the caller to show, never a
 * silent read from stale local data (see docs/backend-roadmap.md on why
 * that was the old, since-removed behavior).
 */
export function useApiClient() {
  const { getAccessToken } = useAuth();

  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const token = await getAccessToken();
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });

      if (!res.ok) {
        throw new ApiError(res.status, await readErrorMessage(res));
      }
      if (res.status === 204) {
        return undefined as T;
      }
      return (await res.json()) as T;
    },
    [getAccessToken]
  );

  return {
    get: <T,>(path: string) => request<T>(path),
    post: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
    patch: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
    del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}
