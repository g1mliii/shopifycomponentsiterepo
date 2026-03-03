import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getEnvOrEmpty } from "./env";

export type SupabaseTestUsersContext = {
  supabaseUrl: string;
  adminEmail: string;
  adminPassword: string;
  nonAdminEmail: string;
  nonAdminPassword: string;
  serviceClient: SupabaseClient;
  cleanup: () => Promise<void>;
};

export async function setupSupabaseAuthTestUsers(): Promise<SupabaseTestUsersContext | null> {
  const supabaseUrl = getEnvOrEmpty("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnvOrEmpty("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnvOrEmpty("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return null;
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const runId = randomUUID();
  const adminEmail = `e2e-admin-${runId}@example.com`;
  const nonAdminEmail = `e2e-user-${runId}@example.com`;
  const adminPassword = `Admin!${runId.slice(0, 10)}Aa1`;
  const nonAdminPassword = `Member!${runId.slice(0, 10)}Aa1`;
  const createdUserIds: string[] = [];

  try {
    const { data: adminUserData, error: adminUserError } = await serviceClient.auth.admin.createUser(
      {
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
      },
    );

    if (adminUserError || !adminUserData.user) {
      throw new Error(adminUserError?.message ?? "Failed to create admin test user.");
    }

    createdUserIds.push(adminUserData.user.id);

    const { error: seedAdminError } = await serviceClient
      .from("admin_users")
      .insert({ user_id: adminUserData.user.id });

    if (seedAdminError) {
      throw new Error(seedAdminError.message);
    }

    const { data: nonAdminUserData, error: nonAdminUserError } =
      await serviceClient.auth.admin.createUser({
        email: nonAdminEmail,
        password: nonAdminPassword,
        email_confirm: true,
      });

    if (nonAdminUserError || !nonAdminUserData.user) {
      throw new Error(nonAdminUserError?.message ?? "Failed to create non-admin test user.");
    }

    createdUserIds.push(nonAdminUserData.user.id);

    return {
      supabaseUrl,
      adminEmail,
      adminPassword,
      nonAdminEmail,
      nonAdminPassword,
      serviceClient,
      cleanup: async () => {
        for (const userId of createdUserIds) {
          await serviceClient.auth.admin.deleteUser(userId);
        }
      },
    };
  } catch (error) {
    for (const userId of createdUserIds) {
      await serviceClient.auth.admin.deleteUser(userId);
    }
    throw error;
  }
}
