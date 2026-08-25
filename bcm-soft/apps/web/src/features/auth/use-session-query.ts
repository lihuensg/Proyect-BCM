import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAppServices } from "../../app/app-services";
import { sessionQueryOptions } from "./auth-queries";

export function useSessionQuery() {
  const { authApi, sessionCoordinator } = useAppServices();
  const query = useQuery(sessionQueryOptions(authApi));

  useEffect(() => {
    if (query.data?.status === "authenticated") {
      sessionCoordinator.markAuthenticated();
    } else if (query.data?.status === "anonymous") {
      sessionCoordinator.markAnonymous();
    }
  }, [query.data, sessionCoordinator]);

  return query;
}
