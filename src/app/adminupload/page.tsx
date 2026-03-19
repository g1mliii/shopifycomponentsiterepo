import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";

import { ComponentsManager } from "../admin/upload/ComponentsManager";

const ADMIN_COMPONENT_LIST_LIMIT = 50;

export const metadata: Metadata = {
  title: "Admin Upload",
  description: "Admin upload dashboard for Shopify Components.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

type StoredComponent = {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string | null;
  file_path: string;
  created_at: string;
  updated_at: string;
};

export default async function AdminUploadPage() {
  const adminResult = await requireAdmin();

  if (!adminResult.ok) {
    if (adminResult.status === 401) {
      redirect("/admin/login?next=/adminupload");
    }

    if (adminResult.status === 403) {
      return (
        <main className="admin-shell mx-auto flex min-h-dvh w-full max-w-6xl items-center justify-center px-5 py-12 sm:px-6">
          <section className="admin-surface w-full max-w-lg p-8 sm:p-10">
            <p className="admin-kicker mb-2">Admin Access</p>
            <h1 className="admin-title text-3xl">
              Admin Access Required
            </h1>
            <p className="admin-muted mt-3 text-sm leading-relaxed">
              Your account is authenticated but not assigned in{" "}
              <code className="rounded bg-[color:var(--color-stone)] px-1.5 py-0.5 text-[color:var(--color-bark)]">public.admin_users</code>.
            </p>
            <Link
              href="/admin/login"
              className="admin-btn admin-btn-secondary mt-5 transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                "--tw-ring-color": "color-mix(in srgb, var(--color-moss) 36%, transparent)",
              } as CSSProperties}
            >
              Sign in with another account
            </Link>
          </section>
        </main>
      );
    }

    return (
      <main className="admin-shell mx-auto flex min-h-dvh w-full max-w-6xl items-center justify-center px-5 py-12 sm:px-6">
        <section className="admin-surface w-full max-w-lg p-8 sm:p-10">
          <p className="admin-kicker mb-2">Admin Access</p>
          <h1 className="admin-title text-3xl">
            Session Verification Failed
          </h1>
          <p className="admin-status admin-status-error mt-4 text-sm">{adminResult.message}</p>
        </section>
      </main>
    );
  }

  const { data: initialComponentsData, error: initialComponentsError } = await adminResult.supabase
    .from("shopify_components")
    .select("id, title, category, thumbnail_path, file_path, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(ADMIN_COMPONENT_LIST_LIMIT);

  return (
    <main className="admin-shell mx-auto min-h-dvh w-full max-w-none px-4 py-8 sm:px-6 lg:px-8">
      <section className="admin-surface p-6 sm:p-8">
        <p className="admin-kicker mb-2">Admin Workspace</p>
        <h1 className="admin-title text-3xl sm:text-4xl">Component Admin Panel</h1>
        <p className="admin-muted mt-3 max-w-2xl text-sm leading-relaxed">
          Signed in as <span className="font-medium">{adminResult.user.email ?? adminResult.user.id}</span>
        </p>
        {initialComponentsError ? (
          <div
            role="status"
            aria-live="polite"
            className="admin-status admin-status-warn mt-5 text-sm"
          >
            Existing components could not be preloaded. Use <span className="font-medium">Refresh List</span>{" "}
            below after the page loads.
          </div>
        ) : null}
        <ComponentsManager
          initialComponents={(initialComponentsData ?? []) as StoredComponent[]}
          listLimit={ADMIN_COMPONENT_LIST_LIMIT}
        />
      </section>
    </main>
  );
}
