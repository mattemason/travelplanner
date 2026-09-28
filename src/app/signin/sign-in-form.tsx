"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function SignInForm() {
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const email = new FormData(e.currentTarget).get("email") as string;
        await signIn("email", { email, callbackUrl: "/" });
      }}
    >
      <label htmlFor="email" className="font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        className="h-12 rounded-lg border border-border bg-surface px-4 text-base"
      />
      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-lg bg-accent font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a link"}
      </button>
    </form>
  );
}
