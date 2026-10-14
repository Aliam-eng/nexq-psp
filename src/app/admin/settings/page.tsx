import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getWhishCredentials, whishEnvFields } from "@/lib/whish";
import { PageHeader, TopBar } from "@/components/ui";
import { SettingsForms } from "./SettingsForms";
import { ChangePassword } from "./ChangePassword";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "TECHNICAL") redirect("/deposit");

  // Effective Whish credentials: server environment (.env) wins over values saved here.
  const whish = await getWhishCredentials();
  const whishRow = await prisma.providerConfig.findUnique({ where: { id: "whish" }, select: { minDeposit: true } });
  const envFields = whishEnvFields();
  const mt5 = await prisma.mt5Config.findUnique({ where: { id: "mt5" } });

  return (
    <>
      <TopBar user={session} />
      <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
        <PageHeader title="Settings" subtitle="Your account, the Whish Pay provider, and the MT5 connection." />
        <ChangePassword email={session.email} />
        <SettingsForms
          whish={{
            baseUrl: whish.baseUrl ?? "https://partner.api.sbx.whish.money/itel-service/api",
            channel: whish.channel ?? "",
            websiteUrl: whish.websiteUrl ?? "",
            userAgent: whish.userAgent ?? "",
            minDeposit: whishRow?.minDeposit ?? 0,
            enabled: whish.enabled,
            hasSecret: !!whish.secret, // the secret itself never leaves the server
            envFields,
            callbackUrl: `${(process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")}/api/webhooks/whish`,
          }}
          mt5={{
            mt5Server: mt5?.mt5Server ?? "",
            mt5Login: mt5?.mt5Login ?? "",
            cryptMethod: (mt5?.cryptMethod as "NONE" | "AES256OFB") ?? "NONE",
            defaultGroup: mt5?.defaultGroup ?? "",
            enabled: mt5?.enabled ?? false,
            hasPassword: !!mt5?.mt5Password,
          }}
        />
      </main>
    </>
  );
}
