import { withAuth } from "@/src/lib/withAuth";
import { compilationProducer } from "@/producer/queue";
import { NextResponse } from "next/server";

export const GET = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    
    const status = await compilationProducer.getJobStatus(jobId);
    
    if (!status) {
      return NextResponse.json(
        { message: "Job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    console.error("[JOB_STATUS_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});

export const DELETE = withAuth(async (req, session, context) => {
  try {
    const { jobId } = await context.params;
    
    const cancelled = await compilationProducer.cancelJob(jobId);
    
    if (!cancelled) {
      return NextResponse.json(
        { message: "Job not found or already processing" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: "Job cancelled successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[JOB_CANCEL_ERROR]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
});