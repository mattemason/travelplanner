import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

const ERRORS: Record<string, string> = {
  AccessDenied: "That email isn't on the list for this app.",
  Verification: "That link has expired or was already used. Request a new one.",
  EmailSignin: "We couldn't send the email. Try again in a minute.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  const message = typeof error === "string" ? (ERRORS[error] ?? "Something went wrong. Try again.") : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Trip Planner</h1>
        <p className="mt-2 text-muted">Enter your email and we&apos;ll send you a sign-in link.</p>
      </div>
      {message && (
        <p role="alert" className="rounded-lg border border-bad-ink px-4 py-3 text-bad-ink">
          {message}
        </p>
      )}
      <SignInForm />
    </main>
  );
}
