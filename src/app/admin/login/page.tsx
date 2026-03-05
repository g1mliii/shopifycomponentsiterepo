import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Admin Login",
  description: "Secure admin login for Shopify Components.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

type AdminLoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getNextSearchParamValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return null;
}

export default async function AdminLoginPage({
  searchParams,
}: AdminLoginPageProps) {
  const [adminResult, resolvedSearchParams] = await Promise.all([
    requireAdmin(),
    searchParams ?? Promise.resolve<Record<string, string | string[] | undefined>>({}),
  ]);
  const nextPathParam = getNextSearchParamValue(resolvedSearchParams.next);

  if (adminResult.ok) {
    redirect("/adminupload");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Admin Login</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Sign in with your admin account to upload Shopify components.
        </p>
        <LoginForm nextPathParam={nextPathParam} />
      </section>
    </main>
  );
}
