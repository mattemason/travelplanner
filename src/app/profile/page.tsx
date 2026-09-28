import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile · Trip Planner" };

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const profile = await getProfile(user.id);
  if (!profile) redirect("/signin");
  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 px-4 pt-[calc(20px+env(safe-area-inset-top))] pb-16">
      <Link href="/" className="text-[14px] text-ocean">
        ‹ Trips
      </Link>
      <h1 className="mt-1 text-[34px] font-bold">Profile</h1>
      <p className="text-[14px] text-muted">{profile.email}</p>
      <ProfileForm initial={profile} />
    </main>
  );
}
