import { queryOptions } from "@tanstack/react-query";

import { ApiError } from "../../lib/http/api-error";
import type { SetupApi } from "./api/setup-api";

export const setupKeys = { status: ["setup", "status"] as const };

export function setupStatusQueryOptions(setupApi: SetupApi) {
  return queryOptions({
    queryKey: setupKeys.status,
    queryFn: () => setupApi.isRequired(),
    // Once configured, an instance never needs setup again.
    staleTime: Number.POSITIVE_INFINITY,
    retry(failureCount, error) {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
