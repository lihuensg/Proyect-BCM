import { randomBytes } from "node:crypto";

import {
  assertDevelopmentLauncher,
  readLocalAuth0Environment,
  readLocalDatabaseUrls,
  run,
  runPnpm,
} from "./local-development.ts";

assertDevelopmentLauncher("The local API launcher");

const { runtimeUrl, migrationUrl } = readLocalDatabaseUrls();
const localEnvironment = readLocalAuth0Environment();
// Local convenience only: deployments set SETUP_TOKEN as a secret.
const setupToken =
  localEnvironment.SETUP_TOKEN ?? randomBytes(32).toString("base64url");
process.stdout.write(
  `Initial setup code (only needed while no Organization exists): ${setupToken}\n`,
);
const serverEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  ...localEnvironment,
  SETUP_TOKEN: setupToken,
  AUTH0_CALLBACK_URL: "http://localhost:3000/api/auth/auth0/callback",
  WEB_APP_ORIGIN: "http://localhost:5173",
  CSRF_HMAC_KEY: randomBytes(32).toString("base64url"),
  DATABASE_URL: runtimeUrl,
  DIRECT_DATABASE_URL: migrationUrl,
  NODE_ENV: "development",
  PORT: "3000",
  RATE_LIMIT_HMAC_KEY: randomBytes(32).toString("base64url"),
  TRUSTED_ORIGINS: "http://localhost:5173",
};

runPnpm(["run", "db:local:up"], process.env);
runPnpm(["run", "db:migrate:deploy"], serverEnvironment);
runPnpm(["run", "build"], serverEnvironment);
run(process.execPath, ["dist/main.js"], serverEnvironment);
