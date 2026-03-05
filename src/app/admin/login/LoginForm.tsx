"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

const DEFAULT_NEXT_PATH = "/adminupload";

function getSafeNextPath(nextPathParam: string | null): string {
  if (!nextPathParam) {
    return DEFAULT_NEXT_PATH;
  }

  if (!nextPathParam.startsWith("/") || nextPathParam.startsWith("//")) {
    return DEFAULT_NEXT_PATH;
  }

  return nextPathParam;
}

type LoginFormProps = {
  nextPathParam?: string | null;
};

export function LoginForm({ nextPathParam = null }: LoginFormProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMountedRef = useRef(true);
  const submitLockRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      submitLockRef.current = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || submitLockRef.current) {
      return;
    }
    submitLockRef.current = true;

    setErrorMessage(null);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (isMountedRef.current) {
          setErrorMessage(error.message || "Unable to sign in.");
        }
        return;
      }

      const nextPath = getSafeNextPath(nextPathParam);
      router.replace(nextPath);
    } catch (error) {
      if (isMountedRef.current) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to sign in.");
      }
    } finally {
      submitLockRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-800">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 transition-colors focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-zinc-800">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 transition-colors focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
        />
      </div>
      {errorMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full touch-manipulation rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Signing In…" : "Sign In"}
      </button>
    </form>
  );
}
