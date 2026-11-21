import { prisma } from "../../src/platform/db/prisma";

// Empties every table the migrations created. Call it in beforeEach of files that write. Triggers that reject TRUNCATE
// (an append-only table's, say) are switched off for this one transaction (replica mode skips ordinary
// triggers). That takes a superuser, which the test container has and the app's database role never does.
export const resetDatabase = async () => {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT format('%I', c.relname) AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET LOCAL session_replication_role = replica"),
    prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => t.name).join(", ")} CASCADE`),
  ]);
};
