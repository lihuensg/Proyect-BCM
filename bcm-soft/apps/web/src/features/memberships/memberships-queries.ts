import { infiniteQueryOptions } from "@tanstack/react-query";

import { ApiError } from "../../lib/http/api-error";
import type { MembershipsApi } from "./api/memberships-api";

// The API scopes Memberships to the Session's current Organization. Until
// Organization switching exists (BCM-TEN-004) there is one per Session, and
// logout clears the whole cache.
export const membershipKeys = {
  all: ["organization", "memberships"] as const,
};

export function membershipsQueryOptions(membershipsApi: MembershipsApi) {
  return infiniteQueryOptions({
    queryKey: membershipKeys.all,
    queryFn: ({ pageParam }) => membershipsApi.list(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // A 4xx (permission, session) will not change on retry.
    retry(failureCount, error) {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
