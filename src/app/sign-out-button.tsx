"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/signin" })}
      className="h-10 rounded-lg border border-line px-3 font-medium text-ink"
    >
      Sign out
    </button>
  );
}
