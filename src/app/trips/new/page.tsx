import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { NewTripForm } from "./new-trip-form";

export default async function NewTripPage() {
  if (!(await currentUser())) redirect("/signin");
  return (
    <main className="mx-auto w-full max-w-[520px] flex-1 px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-16">
      <Link href="/" className="text-[14px] text-ocean">
        ‹ Trips
      </Link>
      <h1 className="mt-1 text-[32px] font-bold">New trip</h1>
      <p className="text-[14px] text-muted">
        Name it and set the dates. You can add legs and stops once it&apos;s created.
      </p>
      <NewTripForm />
    </main>
  );
}
