import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="text-muted">
        If that address is on the list, a sign-in link is on its way. It works once and expires in 24 hours.
      </p>
      <Link href="/signin" className="font-medium text-ocean underline">
        Use a different email
      </Link>
    </main>
  );
}
