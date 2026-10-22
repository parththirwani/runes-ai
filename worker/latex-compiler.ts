// Tectonic invocation.
//
// There are deliberately no sleeps here. The engine has written the PDF by the time it
// exits successfully, so the output file check happens straight away.

import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { CompilerTimings } from '@/src/types/compilation';

const MAX_PDF_BYTES_VALUE = 50 * 1024 * 1024;

/** Upper bound on an accepted PDF, exposed so tests can assert the limit. */
export function maxPdfBytes(): number {
  return MAX_PDF_BYTES_VALUE;
}

export type EngineName = 'direct' | 'docker-exec' | 'docker-run';

export type EngineRun = {
  exitCode: number;
  output: string;
  timedOut: boolean;
  engineMs: number;
  spawnMs: number;
};

export function configuredEngine(): EngineName {
  const explicit = process.env.TECTONIC_ENGINE?.trim().toLowerCase();
  if (explicit === 'direct' || explicit === 'docker-exec' || explicit === 'docker-run') return explicit;
  // Backwards compatible behaviour for deployments that only set a container name.
  if (process.env.TECTONIC_CONTAINER_NAME?.trim()) return 'docker-exec';
  return 'docker-run';
}

export function tectonicBinary(): string {
  return process.env.TECTONIC_BINARY?.trim() || 'tectonic';
}

/**
 * Flags that keep the engine sandboxed and the output stable.
 * --untrusted disables known-insecure features, including the shell escape that
 * -Z shell-escape would otherwise allow.
 */
export function compilerOptions(): string[] {
  const options = ['--untrusted', '--color', 'never', '--print', '--outdir', 'output'];
  if (process.env.TECTONIC_OFFLINE === '1') options.push('--only-cached');
  if (process.env.TECTONIC_KEEP_INTERMEDIATES === '1') options.push('--keep-intermediates');
  return options;
}

export function compilerOptionsForCacheKey(): string[] {
  return compilerOptions().concat(configuredEngine());
}

let cachedVersion: string | null = null;

/** Engine identity is part of the snapshot cache key so an upgrade invalidates results. */
export async function engineVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  const engine = configuredEngine();
  
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const args = engine === 'direct'
        ? ['--version']
        : engine === 'docker-exec'
          ? ['exec', process.env.TECTONIC_CONTAINER_NAME!.trim(), 'tectonic', '--version']
          : ['run', '--rm', process.env.TECTONIC_IMAGE || 'dxjoke/tectonic-docker:latest', 'tectonic', '--version'];
      const command = engine === 'direct' ? tectonicBinary() : 'docker';
      execFile(command, args, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve((stdout || stderr).trim());
      });
    });
    cachedVersion = output.split('\n')[0].trim() || 'unknown';
  } catch {
    // A stable fallback keeps the snapshot cache key deterministic across worker restarts.
    cachedVersion = 'unknown-' + engine;
  }
  return cachedVersion;
}

/**
 * True when the Tectonic bundle cache already holds packages. A cold cache downloads
 * bundles on first use and dominates the first compile after a deploy, so it is measured
 * and reported separately from warm runs.
 */
export async function packageCacheIsWarm(): Promise<boolean | null> {
  if (configuredEngine() !== 'direct') return null;
  const base = process.env.TECTONIC_CACHE_DIR?.trim() || path.join(process.env.HOME || os.homedir(), '.cache');
  // Tectonic 0.15 writes ~/.cache/Tectonic; older builds used lowercase.
  for (const name of ['Tectonic', 'tectonic']) {
    const dir = path.join(base, name);
    const warm = await directoryHasFiles(dir, 2);
    if (warm !== null) return warm;
  }
  return null;
}

async function directoryHasFiles(dir: string, depth: number): Promise<boolean | null> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && depth > 0) {
      const nested = await directoryHasFiles(path.join(dir, entry.name), depth - 1);
      if (nested === true) return true;
    }
  }
  return false;
}

function buildEngineArgs(entryFile: string): string[] {
  return [...compilerOptions(), entryFile];
}

/**
 * Runs one compile of `entryFile` inside `jobDir`.
 * direct      runs the binary in a per job directory (no container start cost)
 * docker-exec runs inside a warm container mounted at the same path
 * docker-run  starts a throwaway container, with resource limits applied
 */
export async function runEngine(jobDir: string, entryFile: string, timeoutMs: number): Promise<EngineRun> {
  const engine = configuredEngine();
  const args = buildEngineArgs(entryFile);
  const startedAt = performance.now();
  const spawnAt = Date.now();

  const commandArgs =
    engine === 'direct'
      ? args
      : engine === 'docker-exec'
        ? ['exec', '-w', jobDir, requireContainerName(), 'tectonic', ...args]
        : [
            'run',
            '--rm',
            '--memory',
            process.env.COMPILER_MEMORY_LIMIT || '1g',
            '--cpus',
            process.env.COMPILER_CPU_LIMIT || '2',
            '--pids-limit',
            '256',
            '--dns',
            '8.8.8.8',
            '--dns',
            '8.8.4.4',
            '-v',
            jobDir + ':/tex:z',
            '-w',
            '/tex',
            process.env.TECTONIC_IMAGE || 'dxjoke/tectonic-docker:latest',
            'tectonic',
            ...args,
          ];

  const command = engine === 'direct' ? tectonicBinary() : 'docker';

  return new Promise<EngineRun>((resolve) => {
    let output = '';
    let truncated = false;
    let timedOut = false;
    const maxOutputBytes = 1024 * 1024;
    let spawnedAt = 0;

    const child = spawn(command, commandArgs, {
      cwd: engine === 'docker-run' ? process.cwd() : jobDir,
      // Only PATH, HOME and the package cache reach the engine; no application secrets.
      env: (engine === 'direct' ? directEnv() : undefined) as NodeJS.ProcessEnv | undefined,
      stdio: 'pipe',
    });
    child.stdin?.end();
    child.on('spawn', () => { spawnedAt = Date.now(); });

    const collect = (chunk: Buffer) => {
      if (truncated) return;
      output += chunk.toString('utf-8');
      if (output.length > maxOutputBytes) {
        output = output.slice(0, maxOutputBytes);
        truncated = true;
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      output += '\n' + (error as Error).message;
      resolve({
        exitCode: 127,
        output,
        timedOut,
        engineMs: Math.round(performance.now() - startedAt),
        spawnMs: (spawnedAt || Date.now()) - spawnAt,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? (signal ? 1 : 0)),
        output: truncated ? output + '\n(engine output truncated)' : output,
        timedOut,
        engineMs: Math.round(performance.now() - startedAt),
        spawnMs: (spawnedAt || Date.now()) - spawnAt,
      });
    });
  });
}

function requireContainerName(): string {
  const name = process.env.TECTONIC_CONTAINER_NAME?.trim();
  if (!name) throw new Error('TECTONIC_ENGINE=docker-exec requires TECTONIC_CONTAINER_NAME');
  return name;
}

/** The engine only ever needs its own directories plus the shared package cache. */
function directEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.TECTONIC_HOME || process.env.HOME,
    LANG: 'C.UTF-8',
  };
  const cacheDir = process.env.TECTONIC_CACHE_DIR?.trim();
  if (cacheDir) {
    env.XDG_CACHE_HOME = cacheDir;
    env.TECTONIC_CACHE_DIR = cacheDir;
  }
  return env;
}

export type CompileOutcome = {
  success: boolean;
  pdfBuffer?: Buffer;
  output: string;
  error?: string;
  timings: CompilerTimings;
  timedOut?: boolean;
};

/**
 * Compiles an already materialized job directory.
 * The PDF is read as soon as the engine exits successfully; no post run delay.
 */
export async function compileJobDirectory(input: {
  jobDir: string;
  mainFile: string;
  timeoutMs: number;
  materializeMs: number;
}): Promise<CompileOutcome> {
  const totalStart = performance.now();
  const cacheWarm = await packageCacheIsWarm();
  const run = await runEngine(input.jobDir, input.mainFile, input.timeoutMs);

  const pdfPath = path.join(input.jobDir, 'output', input.mainFile.replace(/\.tex$/i, '') + '.pdf');
  const readStart = performance.now();

  if (run.timedOut) {
    return {
      success: false,
      output: run.output,
      error: 'Compilation timed out after ' + Math.round(input.timeoutMs / 1000) + 's',
      timedOut: true,
      timings: timingsFor(input.materializeMs, run, 0, totalStart, cacheWarm),
    };
  }

  let stat;
  try {
    stat = await fs.stat(pdfPath);
  } catch {
    return {
      success: false,
      output: run.output,
      error: run.exitCode === 0 ? 'The engine exited without producing a PDF' : undefined,
      timings: timingsFor(input.materializeMs, run, 0, totalStart, cacheWarm),
    };
  }

  if (stat.size === 0) {
    return {
      success: false,
      output: run.output,
      error: 'The engine produced an empty PDF',
      timings: timingsFor(input.materializeMs, run, 0, totalStart, cacheWarm),
    };
  }
  if (stat.size > MAX_PDF_BYTES_VALUE) {
    return {
      success: false,
      output: run.output,
      error: 'The produced PDF is larger than ' + Math.floor(MAX_PDF_BYTES_VALUE / 1024 / 1024) + ' MB',
      timings: timingsFor(input.materializeMs, run, 0, totalStart, cacheWarm),
    };
  }

  const pdfBuffer = await fs.readFile(pdfPath);
  const pdfReadMs = Math.round(performance.now() - readStart);

  return {
    success: true,
    pdfBuffer,
    output: run.output,
    timings: timingsFor(input.materializeMs, run, pdfReadMs, totalStart),
  };
}

function timingsFor(materializeMs: number, run: EngineRun, pdfReadMs: number, totalStart: number, cacheWarm: boolean | null = null): CompilerTimings {
  return {
    materializeMs,
    processSpawnMs: run.spawnMs,
    engineMs: run.engineMs,
    pdfReadMs,
    totalMs: Math.round(performance.now() - totalStart),
    coldPackageCache: cacheWarm === null ? undefined : !cacheWarm,
  };
}

/**
 * Validates LaTeX content for basic syntax.
 * @deprecated kept for the legacy single source path
 */
export function validateLatexContent(content: string): { isValid: boolean; error?: string } {
  if (!content || content.trim().length === 0) return { isValid: false, error: 'LaTeX content is empty' };
  if (!content.includes('\\documentclass')) return { isValid: false, error: 'Missing \\documentclass declaration' };
  if (!content.includes('\\begin{document}')) return { isValid: false, error: 'Missing \\begin{document}' };
  if (!content.includes('\\end{document}')) return { isValid: false, error: 'Missing \\end{document}' };
  return { isValid: true };
}
