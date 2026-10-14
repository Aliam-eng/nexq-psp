import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL, assertSafeTestDb, hasTestDb, prismaCli, withSchema } from "./helpers";

// Upgrading a live Rival-era database: apply every migration up to the Whish
// switch, insert Rival data, then apply the Whish migration and check that the
// data survived and the result matches prisma/schema.prisma exactly.

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const WHISH_MIGRATION = "20261013120000_whish_direct";
const SCHEMA = "migration_check";

describe.skipIf(!hasTestDb)("Rival → Whish migration", () => {
  let url: string;
  let db: PrismaClient;

  const exec = (sql: string) => prismaCli(`db execute --url "${url}" --stdin`, url, sql);
  const applyFile = (dir: string) =>
    prismaCli(`db execute --url "${url}" --file "${join(MIGRATIONS, dir, "migration.sql")}"`, url);

  beforeAll(() => {
    assertSafeTestDb(TEST_DATABASE_URL);
    url = withSchema(TEST_DATABASE_URL, SCHEMA);
    prismaCli(
      `db execute --url "${TEST_DATABASE_URL}" --stdin`,
      TEST_DATABASE_URL,
      `DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE; CREATE SCHEMA "${SCHEMA}";`
    );
    const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs.at(-1)).toBe(WHISH_MIGRATION);
    for (const dir of dirs.slice(0, -1)) applyFile(dir);

    exec(`
      INSERT INTO "ProviderConfig" (id, "apiKey", "minDeposit", enabled, "webhookSecret", "updatedAt")
        VALUES ('rival', 'tsk_dummy_for_test', 25, true, 'whsec', now());
      INSERT INTO "Transaction" (id, "mt5Login", amount, currency, status, reference, "rivalPaymentId", "mt5DealId", "createdAt", "updatedAt")
        VALUES ('done1', '111', 10, 'USD', 'CREDITED', 'NEXQ-OLD00001', 'rival-ext-1', 'D-5', now(), now()),
               ('wait1', '222', 20, 'USD', 'LINK_GENERATED', 'NEXQ-OLD00002', 'rival-ext-2', NULL, now(), now()),
               ('nolink', '333', 30, 'USD', 'FAILED', 'NEXQ-OLD00003', NULL, NULL, now(), now());
    `);

    applyFile(WHISH_MIGRATION);
    db = new PrismaClient({ datasourceUrl: url });
  });

  afterAll(async () => {
    await db?.$disconnect();
    if (hasTestDb) {
      prismaCli(`db execute --url "${TEST_DATABASE_URL}" --stdin`, TEST_DATABASE_URL, `DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE;`);
    }
  });

  it("carries the provider row over as 'whish', keeps the minimum, and disables it", async () => {
    const rows = await db.providerConfig.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "whish",
      minDeposit: 25,
      enabled: false,
      baseUrl: "https://partner.api.sbx.whish.money/itel-service/api",
      channel: null,
      secret: null,
    });
  });

  it("drops the Rival secrets", async () => {
    const cols = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'ProviderConfig'`
    );
    const names = cols.map((c) => c.column_name);
    for (const gone of ["apiKey", "webhookSecret", "createPaymentPath", "statusPath", "healthPath"]) {
      expect(names).not.toContain(gone);
    }
  });

  it("keeps every transaction and its payment id", async () => {
    const txs = await db.transaction.findMany({ orderBy: { reference: "asc" } });
    expect(txs.map((t) => [t.reference, t.status, t.whishExternalId, t.mt5DealId])).toEqual([
      ["NEXQ-OLD00001", "CREDITED", "rival-ext-1", "D-5"],
      ["NEXQ-OLD00002", "LINK_GENERATED", "rival-ext-2", null],
      ["NEXQ-OLD00003", "FAILED", null, null],
    ]);
  });

  it("makes externalId unique", async () => {
    await expect(
      db.transaction.create({
        data: { mt5Login: "1", amount: 1, reference: "NEXQ-DUP", whishExternalId: "rival-ext-1" },
      })
    ).rejects.toThrow(/Unique constraint/);
  });

  it("new config rows default to Whish sandbox", async () => {
    await db.providerConfig.deleteMany();
    const fresh = await db.providerConfig.create({ data: {} });
    expect(fresh).toMatchObject({ id: "whish", baseUrl: "https://partner.api.sbx.whish.money/itel-service/api" });
  });

  it("ends up identical to prisma/schema.prisma", () => {
    // --exit-code: 0 = no difference, 2 = schema drift (execSync throws on non-zero)
    expect(() =>
      prismaCli(`migrate diff --from-url "${url}" --to-schema-datamodel prisma/schema.prisma --exit-code`, url)
    ).not.toThrow();
  });
});
