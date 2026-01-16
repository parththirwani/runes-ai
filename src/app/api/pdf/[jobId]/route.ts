import { withAuth } from "@/src/lib/withAuth";
import { compilationProducer } from "@/producer/queue";
import { NextResponse } from "next/server";
import { JobStatus } from "@/src/types/compilation";

export const GET = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    
    // Check job status first
    const status = await compilationProducer.getJobStatus(jobId);
    
    if (!status) {
      return NextResponse.json(
        { message: "Job not found" },
        { status: 404 }
      );
    }

    if (status.status !== JobStatus.COMPLETED) {
      return NextResponse.json(
        { 
          message: "PDF not ready yet",
          status: status.status
        },
        { status: 400 }
      );
    }

    // Get PDF buffer
    const pdfBuffer = await compilationProducer.getPDF(jobId);
    
    if (!pdfBuffer) {
      return NextResponse.json(
        { message: "PDF not found or expired" },
        { status: 404 }
      );
    }

    // Return PDF
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="document-${jobId}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });

  } catch (error: any) {
    console.error("[PDF_DOWNLOAD_ERROR]", error);
    return NextResponse.json(
      { 
        message: "Failed to download PDF",
        error: error.message || "Internal server error"
      },
      { status: 500 }
    );
  }
});