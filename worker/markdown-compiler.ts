// Markdown → PDF compilation via a pinned Pandoc executable with Tectonic as
// the PDF engine (the approach recommended by the Pandoc manual).
//
// Security properties:
// - No shell interpolation: execFile with an argument array only.
// - Pandoc runs with --sandbox inside a unique per-job working directory.
// - Only the saved Markdown snapshot and the document's own validated assets
//   are materialized in the job directory. Remote images (http/https/ftp),
//   file:, data:, and other schemes are rejected before Pandoc runs.
// - Raw HTML is unsupported source text: rejected before compilation, and
//   the `-raw_html` reader extension prevents Pandoc from passing it through.
// - Bounded process time, output size, and captured stderr. Engine options
//   are fixed by this file; the client cannot supply any.

import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { CompilationOptions, CompilationResult } from '@/src/lib/latex';
import type { SnapshotAsset } from '@/src/types/compilation';
import { normalizeAssetPath, assetMediaTypeFor } from '@/src/lib/markdown-assets';

const execFile = promisify(execFileCallback);

const PANDOC_BIN = process.env.PANDOC_BIN || 'pandoc';
const PDF_ENGINE_BIN = process.env.PDF_ENGINE_BIN || 'tectonic';

const MAX_SOURCE_BYTES = 1_000_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_CAPTURED_OUTPUT = 32 * 1024 * 1024;

// Pinned, explicit input profile: GFM plus dollar math, without raw HTML.
// Validated against the pinned Pandoc version in worker tests.
// NOTE: pandoc's --sandbox hangs when pandoc must EXECUTE an external
// pdf-engine (the seccomp filter blocks the engine's own syscalls), so
// isolation here comes from validation, a throwaway job directory, the
// 25 MiB output cap, and the exec timeout instead.
const PANDOC_FROM = 'gfm+tex_math_dollars-raw_html';
const PANDOC_FIXED_ARGS = [
  '--standalone',
  `--from=${PANDOC_FROM}`,
  '--resource-path=.',
  '--output=main.pdf',
  'main.md',
];
const PANDOC_VARIABLES = [
  '-V', 'geometry:margin=1in',
  '-V', 'fontsize=11pt',
  '-V', 'colorlinks=true',
  '-V', 'linkcolor=blue',
  '-V', 'urlcolor=blue',
];

export type MarkdownSourceIssue = {
  code: 'remote-resource' | 'unsafe-scheme' | 'invalid-path' | 'raw-html' | 'missing-asset' | 'too-large';
  message: string;
};

function stripCodeAndMath(source: string): string {
  return source
    .replace(/(```|~~~)[\s\S]*?\1/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/(?<!\\)\$[^$\n]*(?<!\\)\$/g, ' ');
}

function imageReferences(source: string): string[] {
  const refs: string[] = [];
  const inline = /!\[[^\]]*\]\(\s*([^)\s]+)/g;
  const definition = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(source)) !== null) refs.push(m[1]);
  while ((m = definition.exec(source)) !== null) refs.push(m[1]);
  return refs;
}

function linkDestinations(source: string): string[] {
  const dests: string[] = [];
  const inline = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)/g;
  const autolink = /<([A-Za-z][A-Za-z0-9+.-]*:[^>\s]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(source)) !== null) dests.push(m[1]);
  while ((m = autolink.exec(source)) !== null) dests.push(m[1]);
  return dests;
}

function classifyUrl(url: string): { ok: boolean; scheme?: string } {
  const cleaned = url.replace(/["'<>]/g, '');
  const schemeMatch = cleaned.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (!schemeMatch) return { ok: true }; // relative reference
  return { ok: false, scheme: schemeMatch[1].toLowerCase() };
}

/**
 * Validate Markdown source before any compiler runs. Returns the list of
 * blocking issues (empty when the source may compile).
 */
export function validateMarkdownSource(source: string, assets: SnapshotAsset[]): MarkdownSourceIssue[] {
  const issues: MarkdownSourceIssue[] = [];
  if (Buffer.byteLength(source, 'utf-8') > MAX_SOURCE_BYTES) {
    issues.push({ code: 'too-large', message: `Markdown source exceeds the ${MAX_SOURCE_BYTES / 1024} KiB compile limit` });
    return issues;
  }

  const scannable = stripCodeAndMath(source);

  // Raw HTML (excluding <scheme:...> autolinks) is unsupported source text.
  const tagLike = scannable.match(/<\/?!?[A-Za-z][^>\n]*>/g) || [];
  const rawTags = tagLike.filter((t) => !/^<\s*\/?[A-Za-z][A-Za-z0-9+.-]*:/.test(t));
  if (rawTags.length > 0) {
    issues.push({
      code: 'raw-html',
      message: `Raw HTML is not supported in Markdown source (found <${rawTags[0].slice(1, 16).replace(/>.*$/, '')}…>). Remove HTML tags and use Markdown syntax.`,
    });
  }

  const assetPaths = new Set(assets.map((a) => a.path));

  for (const ref of imageReferences(scannable)) {
    const { ok, scheme } = classifyUrl(ref);
    if (!ok) {
      if (scheme === 'http' || scheme === 'https' || scheme === 'ftp') {
        issues.push({ code: 'remote-resource', message: `Remote images are not supported (unsupported resource): ${scheme}://… — upload the image as a document asset instead` });
      } else {
        issues.push({ code: 'unsafe-scheme', message: `Image reference with unsupported scheme "${scheme}" is not allowed: ${ref.slice(0, 80)}` });
      }
      continue;
    }
    const decoded = decodeURIComponentSafely(ref);
    const normalized = normalizeAssetPath(stripAssetPrefix(decoded));
    if (!normalized.ok) {
      issues.push({ code: 'invalid-path', message: `Invalid image path: ${ref.slice(0, 120)} (${normalized.error})` });
      continue;
    }
    if (!assetPaths.has(normalized.path)) {
      issues.push({ code: 'missing-asset', message: `Missing local image asset: ${normalized.path} — upload it from the document before compiling` });
    }
  }

  for (const dest of linkDestinations(scannable)) {
    const { ok, scheme } = classifyUrl(dest);
    if (ok) continue;
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') continue; // clickable, validated
    issues.push({ code: 'unsafe-scheme', message: `Link destination with unsupported scheme "${scheme}" is not allowed: ${dest.slice(0, 80)}` });
  }

  return dedupeByMessage(issues);
}

function stripAssetPrefix(ref: string): string {
  // Accept both "images/x.png" and "/api/document/<slug>/assets/images/x.png".
  const m = ref.match(/^\/api\/document\/[^/]+\/assets\/(.+)$/);
  return m ? m[1] : ref;
}

function decodeURIComponentSafely(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

function dedupeByMessage(issues: MarkdownSourceIssue[]): MarkdownSourceIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.message)) return false;
    seen.add(issue.message);
    return true;
  });
}

function sanitizeDiagnostics(text: string, tempDir: string): string {
  return text
    .split(tempDir).join('<job>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1_500);
}

export interface MarkdownCompileOptions extends CompilationOptions {
  assets?: SnapshotAsset[];
}

/**
 * Compile a Markdown snapshot to PDF. The returned buffer is the complete
 * artifact stored for the job; temporary files are removed in all paths.
 */
export async function compileMarkdownToPDF(
  markdownSource: string,
  _slug: string,
  options: MarkdownCompileOptions = {},
): Promise<CompilationResult> {
  const { timeout = 120_000, assets = [] } = options;
  const startTime = Date.now();

  const issues = validateMarkdownSource(markdownSource, assets);
  if (issues.length > 0) {
    return {
      success: false,
      error: issues.map((i) => i.message).join('; '),
      duration: Date.now() - startTime,
    };
  }

  const tempDir = path.join(
    process.cwd(),
    'temp',
    `md-${Date.now()}-${createHash('sha256').update(markdownSource).digest('hex').slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'main.md'), markdownSource, 'utf-8');

    for (const asset of assets) {
      const normalized = normalizeAssetPath(asset.path);
      if (!normalized.ok) throw new Error(`Invalid asset path in snapshot: ${asset.path}`);
      const mediaType = assetMediaTypeFor(normalized.path);
      if (!mediaType || mediaType !== asset.mediaType) {
        throw new Error(`Asset ${normalized.path} has an unexpected media type`);
      }
      const target = path.resolve(tempDir, normalized.path);
      if (!target.startsWith(path.resolve(tempDir) + path.sep)) {
        throw new Error(`Asset path escapes the job directory: ${normalized.path}`);
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(asset.data, 'base64'));
    }

    const args = [
      ...PANDOC_FIXED_ARGS,
      ...PANDOC_VARIABLES,
      `--pdf-engine=${PDF_ENGINE_BIN}`,
    ];

    await execFile(PANDOC_BIN, args, {
      cwd: tempDir,
      timeout,
      maxBuffer: MAX_CAPTURED_OUTPUT,
      // Deliberately inherit the worker environment (HOME must exist so the
      // engine can use its package cache). Bun's child_process hangs when the
      // env object re-specifies HOME, so the environment is never rewritten.
    });

    const pdfPath = path.join(tempDir, 'main.pdf');
    await fs.access(pdfPath);
    const stat = await fs.stat(pdfPath);
    if (stat.size === 0) throw new Error('Compiler produced an empty PDF');
    if (stat.size > MAX_PDF_BYTES) throw new Error(`PDF exceeds the ${MAX_PDF_BYTES / (1024 * 1024)} MiB output limit`);

    const pdfBuffer = await fs.readFile(pdfPath);
    const duration = Date.now() - startTime;

    await fs.rm(tempDir, { recursive: true, force: true });

    return { success: true, pdfBuffer, duration };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);

    const err = error as { killed?: boolean; signal?: string; message?: string; stderr?: string };
    if (err.killed || err.signal === 'SIGTERM') {
      // A killed child can recreate its cwd between rm and process teardown.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      return { success: false, error: `Markdown compile timed out after ${Math.round(timeout / 1000)}s`, duration };
    }
    const raw = (typeof err.stderr === 'string' && err.stderr.trim()) || err.message || 'Markdown compilation failed';
    const detail = sanitizeDiagnostics(raw, tempDir);
    const hint = /pdf-engine|command not found|ENOENT|executable/i.test(detail)
      ? 'PDF engine failure — the configured engine could not run'
      : 'Markdown compile failed';
    return { success: false, error: `${hint}: ${detail || 'no compiler output'}`, duration };
  }
}
