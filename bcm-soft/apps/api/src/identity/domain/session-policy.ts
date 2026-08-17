export type SessionPolicy = Readonly<{
  idleTimeoutMilliseconds: number;
  absoluteLifetimeMilliseconds: number;
  touchIntervalMilliseconds: number;
}>;

export function sessionEffectiveDeadline(
  expiresAt: Date,
  lastSeenAt: Date,
  idleTimeoutMilliseconds: number,
): Date {
  return new Date(
    Math.min(
      expiresAt.getTime(),
      lastSeenAt.getTime() + idleTimeoutMilliseconds,
    ),
  );
}

export function isSessionExpired(
  now: Date,
  expiresAt: Date,
  lastSeenAt: Date,
  idleTimeoutMilliseconds: number,
): boolean {
  return (
    now.getTime() >=
    sessionEffectiveDeadline(
      expiresAt,
      lastSeenAt,
      idleTimeoutMilliseconds,
    ).getTime()
  );
}

export function isSessionTouchDue(
  now: Date,
  lastSeenAt: Date,
  touchIntervalMilliseconds: number,
): boolean {
  return now.getTime() - lastSeenAt.getTime() >= touchIntervalMilliseconds;
}
