import { queryOptions } from "@tanstack/react-query";

import { ApiError } from "../../lib/http/api-error";
import type { AuthApi } from "./api/auth-api";

export const authKeys = {
  all: ["auth"] as const,
  session: ["auth", "session"] as const,
};

export function sessionQueryOptions(authApi: AuthApi) {
  return queryOptions({
    queryKey: authKeys.session,
    queryFn: () => authApi.getSession(),
    refetchOnWindowFocus: true,
    retry(failureCount, error) {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 2;
    },
    retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 1_000),
    staleTime: 30_000,
  });
}
