import Link from "next/link";
import { notFound } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const COMPONENT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SandboxPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ComponentSandboxStubPage({ params }: SandboxPageProps) {
  const { id } = await params;

  if (!COMPONENT_ID_REGEX.test(id)) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("shopify_components")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load component sandbox details.");
  }

  if (!data) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-6 py-12">
      <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Phase 4 Preview</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Live Sandbox coming soon</h1>
        <p className="mt-3 text-sm text-zinc-700">
          <span className="font-medium">{data.title}</span> is ready for sandbox support, but live schema editing
          and patched Liquid download ship in Phase 4.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
        >
          Back to gallery
        </Link>
      </section>
    </main>
  );
}
