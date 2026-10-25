import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { getDocumentAccess } from "@/src/lib/access";
import { routeResult } from "@/src/lib/api-result";
import { compilationProducer } from "@/producer/queue";
import { JobStatus } from "@/src/types/compilation";

/**
 * Document-scoped PDF read.
 *
 * A reader is allowed to see a completed compile, but never through a job id: /api/job/[jobId]
 * and /api/pdf/[jobId] stay tied to the user who submitted them, so an old or guessed job id
 * cannot outlive a revoked share. This route decides on the *document* every single request,
 * so revoking access or removing a team member cuts the PDF on the next fetch.
 *
 * If nobody who may compile has produced a PDF for the current bytes, the answer is a plain
 * "No preview available" rather than a queued compile.
 */
export const GET = withAuth(async (req, session, context) =>
  routeResult("DOCUMENT_PDF_GET_ERROR", async () => {
    const { id } = await context.params;
    const access = await getDocumentAccess(prisma, session.user.id, String(id));
    if (!access) return NextResponse.json({ message: "Document not found" }, { status: 404 });

    const probe = new URL(req.url).searchParams.get("probe");
    const jobIds = await compilationProducer.documentJobIds(access.document.id);

    for (const jobId of jobIds) {
      const status = await compilationProducer.getJobStatus(jobId);
      if (!status || status.status !== JobStatus.COMPLETED) continue;

      if (probe === "1") {
        return NextResponse.json({ available: true, jobId, compiledAt: status.timings?.completedAt ?? null });
      }

      const pdf = await compilationProducer.getPDF(jobId);
      if (!pdf || pdf.length === 0) continue;

      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": pdf.length.toString(),
          "Content-Disposition": `inline; filename="${access.document.slug || "document"}.pdf"`,
          // Per-reader, per-request authorisation: never cache a PDF for a shared document.
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return NextResponse.json({ available: false, message: "No preview available" }, { status: 404 });
  }),
);
