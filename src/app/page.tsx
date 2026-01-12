import { auth } from "../lib/auth";

export default async function() {
  const session = await auth();

  if (!session?.user) {
    return <div>Please sign in</div>;
  }

  return <div>Welcome {session.user.name} ({session.user.email})</div>;
}