import { SafeHttpException } from "../../observability/safe-http-exception.js";

export function authenticationRequired(): SafeHttpException {
  return new SafeHttpException(
    401,
    "AUTHENTICATION_REQUIRED",
    "Se requiere una sesi\u00f3n v\u00e1lida.",
  );
}

export function tenantAccessDenied(): SafeHttpException {
  return new SafeHttpException(
    403,
    "TENANT_ACCESS_DENIED",
    "La sesi\u00f3n no tiene acceso a una organizaci\u00f3n activa.",
  );
}

export function tenantSelectionRequired(): SafeHttpException {
  return new SafeHttpException(
    409,
    "TENANT_SELECTION_REQUIRED",
    "Se requiere seleccionar una organizaci\u00f3n.",
  );
}
