import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  // Staff go to the dashboard; everyone else lands on the public deposit page.
  if (session?.role === "TECHNICAL") redirect("/admin/transactions");
  redirect("/deposit");
}
