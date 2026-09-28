import { and, eq } from "drizzle-orm";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import { getDb } from "@/db";
import { users, verificationTokens } from "@/db/schema";
import { sendEmail, signInEmail } from "@/lib/email";

const allowedEmails = () =>
  new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

const toAdapterUser = (u: typeof users.$inferSelect): AdapterUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  emailVerified: u.emailVerified,
});

/** The subset of the Auth.js adapter that email sign-in with JWT sessions uses. */
function drizzleAdapter(): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, "id">) {
      const [u] = await getDb()
        .insert(users)
        .values({ email: data.email.toLowerCase(), name: data.name, emailVerified: data.emailVerified })
        .returning();
      return toAdapterUser(u);
    },
    async getUser(id) {
      const [u] = await getDb().select().from(users).where(eq(users.id, id));
      return u ? toAdapterUser(u) : null;
    },
    async getUserByEmail(email) {
      const [u] = await getDb().select().from(users).where(eq(users.email, email.toLowerCase()));
      return u ? toAdapterUser(u) : null;
    },
    async updateUser({ id, ...data }) {
      const [u] = await getDb()
        .update(users)
        .set({ name: data.name ?? undefined, emailVerified: data.emailVerified ?? undefined })
        .where(eq(users.id, id))
        .returning();
      return toAdapterUser(u);
    },
    async createVerificationToken(token) {
      await getDb().insert(verificationTokens).values(token);
      return token;
    },
    async useVerificationToken({ identifier, token }) {
      const [row] = await getDb()
        .delete(verificationTokens)
        .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token)))
        .returning();
      return row ?? null;
    },
  };
}

export const authOptions: NextAuthOptions = {
  adapter: drizzleAdapter(),
  session: { strategy: "jwt", maxAge: 60 * 24 * 60 * 60 }, // 60 days: stay signed in on the road
  pages: { signIn: "/signin", verifyRequest: "/signin/check-email", error: "/signin" },
  providers: [
    EmailProvider({
      maxAge: 24 * 60 * 60,
      async sendVerificationRequest({ identifier, url }) {
        await sendEmail({ to: identifier, ...signInEmail(url), tag: "sign-in" });
      },
    }),
  ],
  callbacks: {
    // Runs before the link is sent and again when it's used; only allowlisted emails get in.
    async signIn({ user }) {
      return !!user.email && allowedEmails().has(user.email.toLowerCase());
    },
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
};

/** The signed-in user's id and email, or null. */
export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user;
  return u?.id && u.email ? { id: u.id, email: u.email } : null;
}
