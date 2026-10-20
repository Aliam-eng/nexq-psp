import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/access";

export default async function Home() {
  // Active staff go to the dashboard; everyone else lands on the public deposit page.
  if (await currentStaff()) redirect("/admin/transactions");
  redirect("/deposit");
}
