import { notFound } from "next/navigation";

import { getPublicComponentById, isValidComponentId } from "@/lib/components/component-by-id";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { SandboxClient } from "./SandboxClient";

type SandboxPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ComponentSandboxPage({ params }: SandboxPageProps) {
  const { id } = await params;

  if (!isValidComponentId(id)) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const { data: component, error } = await getPublicComponentById(supabase, id);

  if (error) {
    throw new Error("Failed to load component sandbox details.");
  }

  if (!component) {
    notFound();
  }

  return <SandboxClient component={component} />;
}
