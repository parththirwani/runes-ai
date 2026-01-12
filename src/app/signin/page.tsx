import { signIn } from "@/src/lib/auth";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="px-6 py-3 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-100 transition"
        >
          Sign in with Google
        </button>
      </form>
    </div>
  );
}
