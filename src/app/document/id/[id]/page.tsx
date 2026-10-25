"use client";

// Stable-id entry point. New links and shared references use the id, because a slug can be
// renamed and can collide across workspaces. This page asks the API what the signed-in user may
// open and then hands the browser to the one editor implementation, so an id never becomes a
// second code path with its own rules.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DOCUMENTS_PATH } from "@/src/lib/paths";

type ResolveResponse = {
  document: { id: string; title: string; slug: string };
  canonicalPath: string;
};

type Outcome = { canonicalPath: string } | { problem: string };

/**
 * One call, one answer. An id the caller cannot read and an id that does not exist are reported
 * identically, which is exactly what the endpoint returns.
 */
async function resolveDocument(id: string, signal: AbortSignal): Promise<Outcome> {
  try {
    const response = await fetch("/api/documents/" + encodeURIComponent(id), { signal });
    if (response.status === 401) return { problem: "Please sign in again." };
    if (!response.ok) return { problem: "Document not found" };
    const data = (await response.json()) as ResolveResponse;
    return { canonicalPath: data.canonicalPath };
  } catch {
    return { problem: "Could not open this document" };
  }
}

export default function DocumentByIdPage() {
  const router = useRouter();
  const params = useParams();
  const { status } = useSession();
  const id = typeof params.id === "string" ? params.id : "";
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/signin?callbackUrl=" + encodeURIComponent("/document/id/" + id));
      return;
    }
    if (status !== "authenticated" || !id) return;

    const controller = new AbortController();
    // The answer arrives in the continuation, never synchronously in this effect body.
    void resolveDocument(id, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      if ("problem" in outcome) setProblem(outcome.problem);
      else router.replace(outcome.canonicalPath);
    });
    return () => controller.abort();
  }, [status, id, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface px-6 py-8 text-center shadow-paper">
        {problem ? (
          <>
            <p className="mb-2 text-destructive">{problem}</p>
            <p className="mb-6 text-xs text-meta">Tried to open a document by its id</p>
            <button
              type="button"
              onClick={() => router.push(DOCUMENTS_PATH)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-action px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-action-hover"
            >
              Go to Documents
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-action border-t-transparent" />
            <p className="text-foreground">Opening document</p>
            <p className="mt-2 text-xs text-meta">Checking what you may open</p>
          </>
        )}
      </div>
    </div>
  );
}
