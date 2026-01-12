import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/src/lib/db";

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
        } else {
          await prisma.user.update({
            where: { email: user.email! },
            data: {
              firstName: (profile?.given_name as string) || existingUser.firstName,
              lastName: (profile?.family_name as string) || existingUser.lastName,
              image: user.image || existingUser.image,
            },
          });
        }

        return true;
      } catch (error) {
        console.error("[SIGNIN_ERROR]", error);
        return false;
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
    async session({ session, token }) {
      if (session.user) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email! },
        });
        
        if (dbUser) {
          session.user.id = dbUser.id;
        }
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET!,
});