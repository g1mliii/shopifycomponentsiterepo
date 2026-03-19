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
    <main className="admin-shell mx-auto flex min-h-dvh w-full max-w-6xl items-center justify-center px-5 py-12 sm:px-6">
      <section className="admin-surface w-full max-w-xl p-8 sm:p-10">
        <p className="admin-kicker mb-2">Admin Access</p>
        <h1 className="admin-title text-3xl sm:text-4xl">Admin Login</h1>
        <p className="admin-muted mt-3 max-w-md text-sm leading-relaxed">
          Sign in to upload new Shopify components, maintain previews, and keep the library ready for fast campaign work.
        </p>
        <LoginForm nextPathParam={nextPathParam} />
      </section>
    </main>
  );
}
