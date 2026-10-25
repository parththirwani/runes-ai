import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/src/lib/db";
import { ensureDefaultPersonalWorkspace } from "@/src/lib/workspace-ownership";

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      try {
        // Check if user exists in database
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! },
        });

        if (!existingUser) {
          await prisma.user.create({
            data: {
              email: user.email!,
              firstName: (profile?.given_name as string) || null,
              lastName: (profile?.family_name as string) || null,
              image: user.image || null,
            },
          });
        }
        if (existingUser) {
          await prisma.user.update({
            where: { email: user.email! },
            data: {
              firstName: (profile?.given_name as string) || existingUser.firstName,
              lastName: (profile?.family_name as string) || existingUser.lastName,
              image: user.image || existingUser.image,
            },
          });
        }

        // Idempotent and safe under concurrent first requests: a brand new account and an
        // account created before workspaces existed both end up with exactly one default
        // personal workspace before their next request.
        const dbUser = await prisma.user.findUnique({ where: { email: user.email! }, select: { id: true } });
        if (dbUser) await ensureDefaultPersonalWorkspace(prisma, dbUser.id);

        return true;
      } catch (error) {
        console.error("[SIGNIN_DATABASE_ERROR]", error);
        return "/signin?error=service-unavailable";
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      
      if (!token.id && token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email },
        });
        if (dbUser) {
          token.id = dbUser.id;
        }
      }
      
      return token;
    },
    async session({ session }) {
      if (session.user) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email! },
          select: { id: true, isAdmin: true },
        });

        if (dbUser) {
          session.user.id = dbUser.id;
          // Only used to hide navigation. Every admin route re-checks the database flag.
          session.user.isAdmin = dbUser.isAdmin;
        }
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET!,
});
