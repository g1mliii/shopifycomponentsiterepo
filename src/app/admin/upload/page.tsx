import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";

import { UploadForm } from "./UploadForm";

export default async function AdminUploadPage() {
  const adminResult = await requireAdmin();

  if (!adminResult.ok) {
    if (adminResult.status === 401) {
      redirect("/admin/login?next=/admin/upload");
    }

    if (adminResult.status === 403) {
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-6 py-12">
          <section className="w-full max-w-lg rounded-2xl border border-amber-300 bg-amber-50 p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-amber-900">
              Admin Access Required
            </h1>
            <p className="mt-2 text-sm text-amber-800">
              Your account is authenticated but not assigned in{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5">public.admin_users</code>.
            </p>
            <Link
              href="/admin/login"
              className="mt-4 inline-flex rounded-lg border border-amber-700 px-3 py-2 text-sm font-medium text-amber-900 transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
            >
              Sign in with another account
            </Link>
          </section>
        </main>
      );
    }

    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-6 py-12">
        <section className="w-full max-w-lg rounded-2xl border border-red-300 bg-red-50 p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-red-900">
            Session Verification Failed
          </h1>
          <p className="mt-2 text-sm text-red-800">{adminResult.message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-6 py-12">
      <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Upload Component</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Signed in as <span className="font-medium">{adminResult.user.email ?? adminResult.user.id}</span>
        </p>
        <UploadForm />
      </section>
    </main>
  );
}
