import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Initial admin comes from env so no password is hardcoded in the repo.
// The admin can change it later from inside the app (Settings → Account).
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@nexq.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
// Demo client/accounts only outside production (or when SEED_DEMO=true).
const SEED_DEMO = process.env.SEED_DEMO === "true" || process.env.NODE_ENV !== "production";

async function main() {
  // Admin — create with the env password, but NEVER overwrite it on reseed
  // (so a password changed from inside the app is preserved).
  const existingAdmin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: "Administrator",
        password: await bcrypt.hash(ADMIN_PASSWORD, 10),
        role: "TECHNICAL",
      },
    });
    console.log(`Created admin: ${ADMIN_EMAIL}`);
  } else {
    console.log(`Admin already exists: ${ADMIN_EMAIL} (password left unchanged)`);
  }

  // Ensure the singleton config rows exist so Settings loads.
  await prisma.providerConfig.upsert({
    where: { id: "whish" },
    update: {},
    create: {
      id: "whish",
      baseUrl: "https://partner.api.sbx.whish.money/itel-service/api", // sandbox
      enabled: false,
    },
  });
  await prisma.mt5Config.upsert({
    where: { id: "mt5" },
    update: {},
    create: { id: "mt5", gatewayUrl: "http://localhost:4100", defaultGroup: "real\\Standard", enabled: false },
  });

  if (SEED_DEMO) {
    const pwd = await bcrypt.hash("password123", 10);
    await prisma.user.upsert({
      where: { email: "client@nexq.local" },
      update: {},
      create: {
        email: "client@nexq.local",
        name: "Demo Client",
        password: pwd,
        role: "CLIENT",
        accounts: {
          create: [
            { mt5Login: "5000123", label: "Standard USD", currency: "USD" },
            { mt5Login: "5000456", label: "Pro USD", currency: "USD" },
          ],
        },
      },
    });
    console.log("Seeded demo client (client@nexq.local / password123)");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
