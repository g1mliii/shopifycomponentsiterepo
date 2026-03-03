import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function encodeObjectPath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function main() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const runId = `phase1-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const thumbnailPath = `phase1-runtime/${runId}.png`;
  const liquidPath = `phase1-runtime/${runId}.liquid`;

  let cleanupErrors = [];
  let primaryError = null;

  try {
    const thumbnailPayload = Buffer.from("phase1 thumbnail verification payload", "utf8");
    const liquidPayload = Buffer.from("{% schema %}{\"name\":\"Phase1\"}{% endschema %}", "utf8");

    const { error: thumbnailUploadError } = await serviceClient.storage
      .from("component-thumbnails")
      .upload(thumbnailPath, thumbnailPayload, {
        contentType: "image/png",
        upsert: false,
      });
    if (thumbnailUploadError) {
      throw new Error(`Thumbnail upload failed: ${thumbnailUploadError.message}`);
    }

    const { error: liquidUploadError } = await serviceClient.storage
      .from("liquid-files")
      .upload(liquidPath, liquidPayload, {
        contentType: "text/plain",
        upsert: false,
      });
    if (liquidUploadError) {
      throw new Error(`Liquid upload failed: ${liquidUploadError.message}`);
    }

    const { data: publicUrlData } = anonClient.storage
      .from("component-thumbnails")
      .getPublicUrl(thumbnailPath);
    assert(publicUrlData?.publicUrl, "Expected public thumbnail URL to be generated.");

    const publicThumbnailResponse = await fetch(publicUrlData.publicUrl);
    assert(
      publicThumbnailResponse.status === 200,
      `Expected public thumbnail URL status 200, got ${publicThumbnailResponse.status}.`,
    );

    const liquidPublicAccessUrl = `${supabaseUrl}/storage/v1/object/public/liquid-files/${encodeObjectPath(
      liquidPath,
    )}`;
    const liquidPublicAccessResponse = await fetch(liquidPublicAccessUrl);
    assert(
      liquidPublicAccessResponse.status >= 400,
      `Expected direct anon liquid file access to fail, got status ${liquidPublicAccessResponse.status}.`,
    );

    const signupEmail = `phase1-signup-check-${Date.now()}@example.com`;
    const signupPassword = `P1-${randomUUID()}-Aa!`;
    const { error: signupError } = await anonClient.auth.signUp({
      email: signupEmail,
      password: signupPassword,
    });

    assert(signupError, "Expected anon signUp to fail because public signup should be disabled.");
    const errorMessage = signupError.message.toLowerCase();
    assert(
      errorMessage.includes("disabled") ||
        (errorMessage.includes("sign") && errorMessage.includes("up")),
      `Expected signup-disabled style error, got: ${signupError.message}`,
    );

    console.log("phase1 runtime verification passed");
  } catch (error) {
    primaryError = error;
  } finally {
    const { error: thumbnailCleanupError } = await serviceClient.storage
      .from("component-thumbnails")
      .remove([thumbnailPath]);
    if (thumbnailCleanupError) {
      cleanupErrors.push(`Thumbnail cleanup failed: ${thumbnailCleanupError.message}`);
    }

    const { error: liquidCleanupError } = await serviceClient.storage
      .from("liquid-files")
      .remove([liquidPath]);
    if (liquidCleanupError) {
      cleanupErrors.push(`Liquid cleanup failed: ${liquidCleanupError.message}`);
    }
  }

  if (primaryError) {
    if (cleanupErrors.length > 0) {
      console.error(`cleanup warnings after primary failure: ${cleanupErrors.join(" | ")}`);
    }
    throw primaryError;
  }

  if (cleanupErrors.length > 0) {
    throw new Error(cleanupErrors.join(" | "));
  }
}

main().catch((error) => {
  console.error(`phase1 runtime verification failed: ${error.message}`);
  process.exit(1);
});
