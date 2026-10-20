import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/access";
import { Logo } from "@/components/ui";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  // Same DB-verified check as the admin pages: a disabled/deleted account with a
  // still-valid cookie must see the login form, not bounce between /login and /admin.
  if (await currentStaff()) redirect("/admin/transactions");

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* Brand panel */}
      <aside className="band hidden flex-col justify-between p-10 md:flex">
        <Logo href="/deposit" />
        <div>
          <p className="text-3xl font-extrabold leading-tight">
            The next standard <br />
            <span className="text-brand-gradient">in trading.</span>
          </p>
          <p className="mt-3 max-w-sm text-sm text-white/70">Back office for Whish Pay deposits and MT5 crediting.</p>
        </div>
        <p className="text-xs text-white/50">© {new Date().getFullYear()} nexQ Capital</p>
      </aside>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-8 md:hidden">
            <Logo href="/deposit" tone="onLight" />
          </div>
          <h1 className="text-2xl font-extrabold text-ink">Back office</h1>
          <p className="mb-7 mt-1 text-sm text-ink-muted">Sign in to manage deposits and settings.</p>
          <LoginForm />
          <p className="mt-8 text-xs text-ink-dim">
            Want to fund your account?{" "}
            <a href="/deposit" className="font-semibold text-brand-400 hover:underline">
              Make a deposit
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
