import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getWhishCredentials, whishEnvFields } from "@/lib/whish";
import { getThreePayConfig, threePayEnvFields } from "@/lib/threepay";
import { AdminShell } from "@/components/ui";
import { SettingsForms } from "./SettingsForms";
import { ChangePassword } from "./ChangePassword";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await currentStaff();
  if (!session) redirect("/login");
  if (!session.isAdmin) redirect("/admin/transactions"); // operators: no settings

  // Effective Whish credentials: server environment (.env) wins over values saved here.
  const whish = await getWhishCredentials();
  const whishRow = await prisma.providerConfig.findUnique({ where: { id: "whish" }, select: { minDeposit: true, withdrawalsEnabled: true } });
  const envFields = whishEnvFields();
  const mt5 = await prisma.mt5Config.findUnique({ where: { id: "mt5" } });
  const threepay = await getThreePayConfig();
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  return (
    <AdminShell user={session} title="Settings" subtitle="Your account, the payment providers (Whish Pay, USDT via 3Pay) and the MT5 connection.">
      <div className="max-w-5xl">
        <ChangePassword email={session.email} />
        <SettingsForms
          whish={{
            baseUrl: whish.baseUrl ?? "https://partner.api.sbx.whish.money/itel-service/api",
            channel: whish.channel ?? "",
            websiteUrl: whish.websiteUrl ?? "",
            userAgent: whish.userAgent ?? "",
            minDeposit: whishRow?.minDeposit ?? 0,
            enabled: whish.enabled,
            withdrawalsEnabled: whishRow?.withdrawalsEnabled ?? true,
            hasSecret: !!whish.secret, // the secret itself never leaves the server
            envFields,
            callbackUrl: `${(process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")}/api/webhooks/whish`,
          }}
          threepay={{
            baseUrl: threepay.baseUrl,
            apiKey: threepay.apiKey ?? "",
            hasApiSecret: !!threepay.apiSecret, // secrets never leave the server
            hasWebhookSecret: !!threepay.webhookSecret,
            minDeposit: threepay.minDeposit,
            enabled: threepay.enabled,
            withdrawalsEnabled: threepay.withdrawalsEnabled,
            webhookUrl: `${base}/api/webhooks/3pay`,
            envFields: threePayEnvFields(),
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
      </div>
    </AdminShell>
  );
}
