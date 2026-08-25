import process from "node:process";

import { createDevelopmentUser } from "../dist/development/create-development-user.js";

try {
  await createDevelopmentUser(process.env, (message) =>
    process.stdout.write(`${message}\n`),
  );
} catch {
  process.stderr.write("Development user provisioning failed.\n");
  process.exitCode = 1;
}
