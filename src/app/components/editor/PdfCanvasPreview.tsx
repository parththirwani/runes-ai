"use client";

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { safePreviewUrl } from '@/src/lib/markdown-preview';

interface PdfCanvasPreviewProps {
  pdfUrl: string;
  zoom: number;
}

type PdfLink = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  href?: string;
  destination?: string | unknown[];
};

function PdfPage({ document: pdfDocument, pageNumber, zoom, availableWidth }: { document: PDFDocumentProxy; pageNumber: number; zoom: number; availableWidth: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [links, setLinks] = useState<PdfLink[]>([]);

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (!placeholder) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '400px' });
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    const pageContainer = placeholderRef.current;
    if (!canvas || !textContainer || !pageContainer) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let textLayer: import('pdfjs-dist').TextLayer | undefined;
    setLinks([]);
    textContainer.replaceChildren();

    void (async () => {
      const page = await pdfDocument.getPage(pageNumber);
      if (cancelled) return;
      const pageWidth = page.getViewport({ scale: 1 }).width;
      const fitScale = Math.min(4 / 3, (availableWidth - 32) / pageWidth);
      const scale = fitScale * zoom / 100;
      const viewport = page.getViewport({ scale });
      pageContainer.style.setProperty('--total-scale-factor', String(scale));
      const pixelRatio = window.devicePixelRatio || 1;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      const [textContent, annotations, pdfjs] = await Promise.all([
        page.getTextContent(),
        page.getAnnotations({ intent: 'display' }),
        import('pdfjs-dist'),
      ]);
      if (cancelled) return;

      textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: textContainer, viewport });
      await textLayer.render();
      if (cancelled) return;

      setLinks(annotations.flatMap((annotation, index): PdfLink[] => {
        if (!Array.isArray(annotation.rect) || annotation.rect.length !== 4) return [];
        const href = typeof annotation.url === 'string' ? safePreviewUrl(annotation.url, 'link') ?? undefined : undefined;
        const destination = typeof annotation.dest === 'string' || Array.isArray(annotation.dest) ? annotation.dest : undefined;
        if (!href && !destination) return [];
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);
        return [{
          id: String(annotation.id ?? index),
          left: Math.min(x1, x2),
          top: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
          href,
          destination,
        }];
      }));
      await renderTask.promise;
    })().catch((error: unknown) => {
      if (!cancelled) console.error('PDF page load failed:', error);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [availableWidth, pdfDocument, pageNumber, visible, zoom]);

  const followDestination = async (destination: string | unknown[]) => {
    const target = typeof destination === 'string' ? await pdfDocument.getDestination(destination) : destination;
    if (!Array.isArray(target)) return;
    const pageRef = target[0];
    const pageIndex = typeof pageRef === 'number' ? pageRef : await pdfDocument.getPageIndex(pageRef);
    placeholderRef.current?.parentElement?.querySelector(`[data-pdf-page="${pageIndex + 1}"]`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <div ref={placeholderRef} data-pdf-page={pageNumber} className="relative mx-auto mb-4 w-fit min-h-64 bg-white border border-border shadow-paper">
      <canvas ref={canvasRef} className="block max-w-none" aria-label={`PDF page ${pageNumber}`} role="img" />
      <div ref={textLayerRef} className="pdf-page-text-layer" />
      <div className="absolute inset-0 z-10 pointer-events-none" aria-label={`PDF page ${pageNumber} links`}>
        {links.map((link) => {
          const style = { left: link.left, top: link.top, width: link.width, height: link.height };
          return link.href ? (
            <a key={link.id} href={link.href} target="_blank" rel="noopener noreferrer" title={link.href} style={style} className="absolute pointer-events-auto hover:bg-action/10" />
          ) : (
            <button key={link.id} type="button" aria-label="Jump to PDF section" onClick={() => void followDestination(link.destination!)} style={style} className="absolute pointer-events-auto cursor-pointer hover:bg-action/10" />
          );
        })}
      </div>
    </div>
  );
}

export default function PdfCanvasPreview({ pdfUrl, zoom }: PdfCanvasPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setAvailableWidth(container.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;
    setDocument(null);
    setError(false);

    void import('pdfjs-dist').then((pdfjs) => {
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      loadingTask = pdfjs.getDocument(pdfUrl);
      return loadingTask.promise;
    }).then((pdf) => {
      if (!pdf) return;
      if (cancelled) {
        void pdf.destroy();
        return;
      }
      setDocument(pdf);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        console.error('PDF preview failed:', cause);
        setError(true);
      }
    });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [pdfUrl]);

  return (
    <div ref={containerRef} className="w-full min-w-0 py-4" data-testid="pdf-pages">
      {error ? (
        <p className="p-6 text-center text-sm text-destructive">Could not display the PDF preview. You can still download it.</p>
      ) : !document || !availableWidth ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Loading PDF preview...</p>
      ) : Array.from({ length: document.numPages }, (_, index) => (
        <PdfPage key={index + 1} document={document} pageNumber={index + 1} zoom={zoom} availableWidth={availableWidth} />
      ))}
    </div>
  );
}
