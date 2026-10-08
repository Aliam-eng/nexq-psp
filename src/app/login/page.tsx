import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Logo } from "@/components/ui";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.role === "TECHNICAL" ? "/admin/transactions" : "/deposit");

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex justify-center">
          <Logo href="/deposit" />
        </div>
        <div className="card overflow-hidden">
          <div className="bg-brand-gradient h-1" />
          <div className="p-7">
          <h1 className="text-xl font-bold text-ink">Back office</h1>
          <p className="mb-6 mt-1 text-sm text-ink-muted">Sign in to manage deposits and settings.</p>
          <LoginForm />
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-ink-dim">
          Want to fund your account?{" "}
          <a href="/deposit" className="text-brand-400 hover:underline">
            Make a deposit
          </a>
        </p>
      </div>
    </div>
  );
}
