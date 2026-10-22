// Markdown → PDF compilation via a pinned Pandoc executable with Tectonic as
// the PDF engine (the approach recommended by the Pandoc manual).
//
// Security properties:
// - No shell interpolation: execFile with an argument array only.
// - Pandoc is wrapped in a private network namespace (`unshare --net
//   --kill-child`) whenever the kernel allows it, so the compiler process
//   tree has no network at all (verified by tests). Isolation is required by
//   default; `COMPILER_REQUIRE_NETNS=0` is a local development escape hatch.
//   Docker's default
//   seccomp profile blocks this, so the worker needs
//   `cap_add: [SYS_ADMIN]` (or an equivalent custom seccomp profile) to get
//   the namespace; memory limits remain the container runtime's job.
// - Timeout kills use SIGKILL and `--kill-child` sets PDEATHSIG on Pandoc,
//   so timed-out jobs tear down the process tree instead of leaking it.
// - Pandoc runs in a unique per-job working directory (pandoc's own
//   --sandbox is unusable: it blocks the external pdf-engine process).
// - Only the saved Markdown snapshot and the document's own validated assets
//   are materialized in the job directory. Remote images (http/https/ftp),
//   file:, data:, and other schemes are rejected before Pandoc runs.
// - Raw HTML is unsupported source text: rejected before compilation, and
//   the `-raw_html` reader extension prevents Pandoc from passing it through.
// - Bounded process time, output size, and captured stderr. Engine options
//   are fixed by this file; the client cannot supply any. Tectonic's
//   --only-cached and --untrusted modes prevent resource downloads and
//   disable its known-insecure features even outside the Compose setup.

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

const DEFINITION_RE = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(\S+)/gm;

function extractDefinitions(scannable: string): Map<string, string> {
  const defs = new Map<string, string>();
  const re = new RegExp(DEFINITION_RE.source, 'gm');
  let m: RegExpExecArray | null;
  while ((m = re.exec(scannable)) !== null) {
    let dest = m[2];
    if (dest.startsWith('<')) {
      const wrapped = dest.match(/^<([^>\s]*)>/);
      dest = wrapped ? wrapped[1] : dest.slice(1);
    }
    if (dest) defs.set(m[1].toLowerCase(), dest);
  }
  return defs;
}

function skipDefinitions(scannable: string): string {
  // Remove definition lines so their brackets are not mistaken for uses.
  return scannable.replace(new RegExp(DEFINITION_RE.source, 'gm'), ' ');
}

function imageDestinations(source: string): string[] {
  const text = skipDefinitions(source);
  const defs = extractDefinitions(source);
  const dests: string[] = [];
  const inline = /!\[[^\]]*\]\(\s*([^)\s]+)/g;
  const fullRef = /!\[([^\]]*)\]\[([^\]]*)\]/g;
  const shortcut = /!\[([^[\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(text)) !== null) dests.push(m[1]);
  const pendingLabels: string[] = [];
  const matchedFull = new Set<number>();
  while ((m = fullRef.exec(text)) !== null) {
    matchedFull.add(m.index);
    pendingLabels.push((m[2] || m[1]).toLowerCase());
  }
  while ((m = shortcut.exec(text)) !== null) {
    // `![a][b]` is a full reference, not two shortcuts; a shortcut is a plain
    // `![label]` not followed by ( or [.
    const next = text[m.index + m[0].length];
    if (next === '(' || next === '[') continue;
    if (matchedFull.has(m.index)) continue;
    pendingLabels.push(m[1].toLowerCase());
  }
  for (const label of pendingLabels) {
    const dest = defs.get(label);
    if (dest) dests.push(dest);
    // Unresolved reference-image labels render as literal text: never fetched.
  }
  return dests;
}

function linkDestinations(source: string): string[] {
  const text = skipDefinitions(source);
  const defs = extractDefinitions(source);
  const dests: string[] = [];
  const inline = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)/g;
  const autolink = /<([A-Za-z][A-Za-z0-9+.-]*:[^>\s]+)>/g;
  const fullRef = /(?<!!)\[([^\]]*)\]\[([^\]]*)\]/g;
  const shortcut = /(?<!!)\[([^[\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(text)) !== null) dests.push(m[1]);
  while ((m = autolink.exec(text)) !== null) dests.push(m[1]);
  const pendingLabels: string[] = [];
  const matchedFull = new Set<number>();
  while ((m = fullRef.exec(text)) !== null) {
    matchedFull.add(m.index);
    pendingLabels.push((m[2] || m[1]).toLowerCase());
  }
  while ((m = shortcut.exec(text)) !== null) {
    const next = text[m.index + m[0].length];
    if (next === '(' || next === '[') continue;
    if (matchedFull.has(m.index)) continue;
    pendingLabels.push(m[1].toLowerCase());
  }
  for (const label of pendingLabels) {
    const dest = defs.get(label);
    if (dest) dests.push(dest);
  }
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

  issues.push(...validateResourceDestinations(imageDestinations(scannable), linkDestinations(scannable), assets));
  return dedupeByMessage(issues);
}

function validateResourceDestinations(
  imageRefs: string[],
  linkRefs: string[],
  assets: SnapshotAsset[],
  expectedSlug?: string,
): MarkdownSourceIssue[] {
  const issues: MarkdownSourceIssue[] = [];
  const assetPaths = new Set(assets.map((a) => a.path));
  for (const ref of imageRefs) {
    const { ok, scheme } = classifyUrl(ref);
    if (!ok) {
      if (scheme === 'http' || scheme === 'https' || scheme === 'ftp') {
        issues.push({ code: 'remote-resource', message: `Remote images are not supported (unsupported resource): ${scheme}://… — upload the image as a document asset instead` });
      } else {
        issues.push({ code: 'unsafe-scheme', message: `Image reference with unsupported scheme "${scheme}" is not allowed: ${ref.slice(0, 80)}` });
      }
      continue;
    }
    if (expectedSlug && ref.startsWith('/api/document/') &&
        !ref.startsWith(`/api/document/${expectedSlug}/assets/`)) {
      issues.push({ code: 'invalid-path', message: 'Image asset URL belongs to a different document' });
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

  for (const dest of linkRefs) {
    const { ok, scheme } = classifyUrl(dest);
    if (ok) continue;
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') continue; // clickable, validated
    issues.push({ code: 'unsafe-scheme', message: `Link destination with unsupported scheme "${scheme}" is not allowed: ${dest.slice(0, 80)}` });
  }

  return dedupeByMessage(issues);
}

// Pandoc's AST is authoritative for GFM reference labels and multiline
// definitions. The quick source scan above gives early errors, then this
// second pass catches valid syntax that a regex cannot classify reliably.
function parsedResourceDestinations(ast: unknown): { images: string[]; links: string[] } {
  const images: string[] = [];
  const links: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as { t?: string; c?: unknown };
    if ((node.t === 'Image' || node.t === 'Link') && Array.isArray(node.c)) {
      const target = node.c[2];
      if (Array.isArray(target) && typeof target[0] === 'string') {
        (node.t === 'Image' ? images : links).push(target[0]);
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(ast);
  return { images, links };
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
const ASSET_URL_RE = /\/api\/document\/[A-Za-z0-9-]+\/assets\//g;

/**
 * Canonical local-image syntax (shared with the reading preview and the
 * editor upload flow) is the document's own asset URL:
 *   ![alt](/api/document/<slug>/assets/<path>)
 * Pandoc receives the document's assets materialized at those relative
 * paths inside the job directory, so the API prefix is rewritten to the
 * relative form before compilation. Fenced code blocks are left untouched.
 */
export function rewriteAssetUrlsForEngine(source: string): string {
  let inFence = false;
  return source
    .split('\n')
    .map((line) => {
      if (/^[ \t]{0,3}(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(ASSET_URL_RE, '');
    })
    .join('\n');
}

const UNSHARE_BIN = process.env.COMPILER_UNSHARE_BIN || '/usr/bin/unshare';
const REQUIRE_NETNS = process.env.COMPILER_REQUIRE_NETNS !== '0';

// Cached probe: the worker asks the kernel once whether a private network
// namespace can be created here (unshare --net), then reuses the verdict.
let isolationProbe: Promise<string[] | null> | null = null;

export function detectCompilerIsolation(): Promise<string[] | null> {
  if (!isolationProbe) {
    isolationProbe = execFile(UNSHARE_BIN, ['--net', '--kill-child', '--', 'true'], { timeout: 5_000 })
      .then(() => [UNSHARE_BIN, '--net', '--kill-child'])
      .catch(() => null);
  }
  return isolationProbe;
}

export async function compileMarkdownToPDF(
  markdownSource: string,
  slug: string,
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

  // Probe before writing the source or assets to disk. A required but
  // unavailable namespace must not leave the rejected snapshot behind.
  const isolation = await detectCompilerIsolation();
  if (!isolation && REQUIRE_NETNS) {
    return {
      success: false,
      error: 'Compiler network isolation unavailable: unshare --net could not run. Run the worker with permission to create a private network namespace.',
      duration: Date.now() - startTime,
    };
  }
  if (!isolation) {
    console.warn('[MD_COMPILER] WARNING: unshare --net unavailable — Pandoc runs WITHOUT a private network namespace (development override).');
  }

  const tempDir = path.join(
    process.cwd(),
    'temp',
    `md-${Date.now()}-${createHash('sha256').update(markdownSource).digest('hex').slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'main.md'), markdownSource, 'utf-8');

    const parseArgs = [`--from=${PANDOC_FROM}`, '--to=json', 'main.md'];
    const parsed = await execFile(isolation ? isolation[0] : PANDOC_BIN,
      isolation ? [...isolation.slice(1), PANDOC_BIN, ...parseArgs] : parseArgs,
      { cwd: tempDir, timeout: Math.min(timeout, 30_000), killSignal: 'SIGKILL', maxBuffer: MAX_CAPTURED_OUTPUT });
    const parsedResources = parsedResourceDestinations(JSON.parse(parsed.stdout));
    const parsedIssues = validateResourceDestinations(parsedResources.images, parsedResources.links, assets, slug);
    if (parsedIssues.length > 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return { success: false, error: parsedIssues.map((issue) => issue.message).join('; '), duration: Date.now() - startTime };
    }
    await fs.writeFile(path.join(tempDir, 'main.md'), rewriteAssetUrlsForEngine(markdownSource), 'utf-8');

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
      '--pdf-engine-opt=--only-cached',
      '--pdf-engine-opt=--untrusted',
    ];

    await execFile(isolation ? isolation[0] : PANDOC_BIN, isolation ? [...isolation.slice(1), PANDOC_BIN, ...args] : args, {
      cwd: tempDir,
      timeout,
      killSignal: 'SIGKILL',
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
