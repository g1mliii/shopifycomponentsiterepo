import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type AuthSuccess = {
  ok: true;
  supabase: ServerSupabaseClient;
  user: User;
};

type AuthFailure = {
  ok: false;
  status: 401 | 403 | 500;
  code: "unauthenticated" | "forbidden" | "auth_check_failed";
  message: string;
};

export type RequireUserResult = AuthSuccess | AuthFailure;
export type RequireAdminResult = AuthSuccess | AuthFailure;

export async function requireUser(): Promise<RequireUserResult> {
  let supabase: ServerSupabaseClient;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return {
      ok: false,
      status: 500,
      code: "auth_check_failed",
      message: "Supabase environment is not configured.",
    };
  }

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes("auth session missing")) {
      return {
        ok: false,
        status: 401,
        code: "unauthenticated",
        message: "Authentication required.",
      };
    }

    return {
      ok: false,
      status: 500,
      code: "auth_check_failed",
      message: "Failed to verify user session.",
    };
  }

  if (!data.user) {
    return {
      ok: false,
      status: 401,
      code: "unauthenticated",
      message: "Authentication required.",
    };
  }

  return {
    ok: true,
    supabase,
    user: data.user,
  };
}

export async function requireAdmin(): Promise<RequireAdminResult> {
  const userResult = await requireUser();

  if (!userResult.ok) {
    return userResult;
  }

  const { supabase, user } = userResult;
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      code: "auth_check_failed",
      message: "Failed to verify admin access.",
    };
  }

  if (!data) {
    return {
      ok: false,
      status: 403,
      code: "forbidden",
      message: "Admin access required.",
    };
  }

  return userResult;
}
