import { withAuth } from "@/src/lib/withAuth";
import { compilationProducer } from "@/producer/queue";
import { NextResponse } from "next/server";
import { JobStatus } from "@/src/types/compilation";

async function verifyJobOwnership(jobId: string, userId: string): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const jobDataStr = await compilationProducer.getRawJobData(jobId);
  if (!jobDataStr) {
    return { ok: false, response: NextResponse.json({ message: "Job not found" }, { status: 404 }) };
  }
  try {
    const jobData = JSON.parse(jobDataStr);
    if (jobData.userId !== userId) {
      return { ok: false, response: NextResponse.json({ message: "Job not found" }, { status: 404 }) };
    }
    return { ok: true };
  } catch {
    return { ok: false, response: NextResponse.json({ message: "Job not found" }, { status: 404 }) };
  }
}

export const GET = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    if (!jobId) {
      return NextResponse.json({ message: "Job ID is required" }, { status: 400 });
    }

    const userId = session.user.id;
    const ownership = await verifyJobOwnership(jobId, userId);
    if (!ownership.ok) return ownership.response;

    const status = await compilationProducer.getJobStatus(jobId);
    if (!status) {
      return NextResponse.json({ message: "Job not found" }, { status: 404 });
    }

    if (status.status !== JobStatus.COMPLETED) {
      return NextResponse.json(
        { message: "PDF not ready yet", currentStatus: status.status },
        { status: 400 }
      );
    }

    const pdfBuffer = await compilationProducer.getPDF(jobId);
    if (!pdfBuffer || pdfBuffer.length === 0) {
      return NextResponse.json({ message: "PDF not found or has expired" }, { status: 404 });
    }

    const pdfUint8Array = new Uint8Array(pdfBuffer);

    return new NextResponse(pdfUint8Array, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="document-${jobId}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error: any) {
    console.error("[PDF_DOWNLOAD_ERROR]", error);
    return NextResponse.json(
      {
        message: "Failed to download PDF",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      },
      { status: 500 }
    );
  }
});