import { defineConfig } from "prisma/config";

import { loadMigrationDatabaseConfig } from "./src/config/database-config.ts";

const migrationConfig = loadMigrationDatabaseConfig(process.env);

export default defineConfig({
  datasource: {
    url: migrationConfig.migrationUrl,
  },
  migrations: {
    path: "prisma/migrations",
  },
  schema: "prisma/schema.prisma",
});
