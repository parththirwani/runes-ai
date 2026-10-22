#!/usr/bin/env node
// End-to-end compile latency harness for Runes AI.
//
// Measures the same path a user's click takes: optional save, compile API, queue,
// worker, PDF status observation, and PDF download. Writes one JSON object per
// iteration to the --out file plus a summary table on stdout.
//
// Examples:
//   node scripts/bench/bench.mjs --workload small --iterations 10 --poll 2000:2000 --out base-small.jsonl
//   node scripts/bench/bench.mjs --workload project --workspace --iterations 10 --poll 50:0 --out after-project.jsonl

import { writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { smallSource, projectFiles, projectFlattenedSource, makePng, FIGURE_PATH } from './fixtures.mjs';

const args = process.argv.slice(2);
function flag(name, fallback = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  if (i + 1 >= args.length || args[i + 1].startsWith('--')) return true;
  return args[i + 1];
}

const BASE = flag('base', process.env.BENCH_BASE || 'http://127.0.0.1:3000');
const WORKLOAD = flag('workload', 'small');
const ITERATIONS = Number(flag('iterations', 5));
const CONCURRENCY = Number(flag('concurrency', 1));
const WORKSPACE = Boolean(flag('workspace', false));
const OUT = flag('out', `/tmp/bench-${WORKLOAD}-${Date.now()}.jsonl`);
const [POLL_FIRST, POLL_INTERVAL] = String(flag('poll', '50:0')).split(':').map(Number);
const LABEL = flag('label', 'run');

if (!existsSync(path.dirname(OUT))) mkdirSync(path.dirname(OUT), { recursive: true });
if (existsSync(OUT)) rmSync(OUT);

let cookie = '';
const start = Date.now();
// Document titles are globally unique and capped at 30 characters, so markers stay short.
const nonce = () => `b${Date.now().toString(36).slice(-7)}${Math.random().toString(36).slice(2, 6)}`;

async function api(p, init = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${p}`, {
    ...init,
    headers: { ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) },
  });
  const elapsed = performance.now() - t0;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : type === 'application/pdf' ? Buffer.from(await res.arrayBuffer()) : await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return { data, elapsed };
}

async function login() {
  const res = await fetch(`${BASE}/api/dev-login`, { method: 'POST' });
  if (!res.ok) throw new Error(`dev-login failed: ${res.status}`);
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  cookie = raw.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (!cookie.includes('dev-session')) throw new Error('dev-session cookie missing');
}

async function createDocument(title, content) {
  const { data } = await api('/api/document', { method: 'POST', body: JSON.stringify({ title, content }) });
  return data;
}

async function uploadWorkspaceFile(slug, filePath, content) {
  const form = new FormData();
  form.append('path', filePath);
  form.append('file', new Blob([content]), path.basename(filePath));
  return api(`/api/document/${slug}/upload`, { method: 'POST', body: form });
}

async function writeWorkspaceFile(slug, filePath, content, baseRevision = null) {
  return api(`/api/document/${slug}/file`, {
    method: 'PUT',
    body: JSON.stringify(baseRevision === null ? { path: filePath, content } : { path: filePath, content, baseRevision }),
  });
}

// One compile, timed the way the editor experiences it.
async function runIteration(makeMarker) {
  const marker = makeMarker();
  const record = { label: LABEL, workload: WORKLOAD, marker, workspace: WORKSPACE, iterations: 0 };

  let slug;
  if (WORKSPACE) {
    const doc = await createDocument(`bench ${marker}`, smallSource(marker));
    slug = doc.slug;
    const files = projectFiles(marker);
    for (const [p, content] of Object.entries(files)) await writeWorkspaceFile(slug, p, content);
    await uploadWorkspaceFile(slug, FIGURE_PATH, makePng());
    const tMain = Date.now();
    await api(`/api/document/${slug}/main`, { method: 'POST', body: JSON.stringify({ path: 'main.tex' }) });
    record.mainSetMs = Math.round(performance.now() - tMain);
  } else {
    const doc = await createDocument(`bench ${marker}`, WORKLOAD === 'project' ? projectFlattenedSource(marker) : smallSource(marker));
    slug = doc.slug;
  }

  // --- click to compile: the editor only saves when something is dirty ---
  const tClick = performance.now();
  const tSave = performance.now();
  await api(`/api/document/${slug}`, { method: 'PUT', body: JSON.stringify({ content: WORKSPACE ? projectFiles(marker)['main.tex'] : (WORKLOAD === 'project' ? projectFlattenedSource(marker) : smallSource(marker)) }) });
  record.saveMs = Math.round(performance.now() - tSave);

  const tEnqueue = performance.now();
  const queued = await api(`/api/document/${slug}`, { method: 'POST' });
  record.enqueueMs = Math.round(performance.now() - tEnqueue);
  const jobId = queued.data.jobId;
  record.jobId = jobId;
  record.reused = Boolean(queued.data.reused);

  let poll = 0;
  let status;
  const tPoll = performance.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, poll === 0 ? POLL_FIRST : POLL_INTERVAL));
    const res = await api(`/api/job/${jobId}`);
    status = res.data;
    poll += 1;
    if (status.status === 'completed' || status.status === 'failed') break;
    if (performance.now() - tPoll > 180000) throw new Error(`job ${jobId} did not finish`);
  }
  record.polls = poll;
  record.completedAt = Math.round(performance.now() - tClick);
  record.status = status.status;
  record.compileDurationMs = status.result?.duration;
  if (status.status === 'failed') {
    record.error = String(status.result?.error || '').slice(0, 400);
  }

  const tPdf = performance.now();
  const pdf = await api(`/api/pdf/${jobId}`);
  record.pdfMs = Math.round(performance.now() - tPdf);
  record.pdfBytes = pdf.data.length;
  record.totalMs = Math.round(performance.now() - tClick);
  record.pdfUrl = `/api/pdf/${jobId}`;
  record.pdf = undefined;
  appendFileSync(OUT, JSON.stringify({ ...record, pdfBytes: record.pdfBytes }) + '\n');
  return record;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(records, name) {
  const done = records.filter((r) => !r.error);
  const pick = (key) => done.map((r) => r[key]).filter((v) => typeof v === 'number');
  const line = (key) => {
    const v = pick(key);
    if (v.length === 0) return null;
    return { metric: key, n: v.length, min: Math.min(...v), p50: percentile(v, 50), p95: percentile(v, 95), max: Math.max(...v), mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length) };
  };
  const rows = ['saveMs', 'enqueueMs', 'completedAt', 'compileDurationMs', 'pdfMs', 'totalMs'].map(line).filter(Boolean);
  const bytes = pick('pdfBytes');
  console.log(`\n== ${name} (n=${done.length}/${records.length}, poll=${POLL_FIRST}:${POLL_INTERVAL}, concurrency=${CONCURRENCY}) ==`);
  console.log('metric'.padEnd(18), 'n'.padStart(4), 'p50'.padStart(7), 'p95'.padStart(7), 'min'.padStart(7), 'max'.padStart(7), 'mean'.padStart(7));
  for (const r of rows) {
    console.log(r.metric.padEnd(18), String(r.n).padStart(4), String(r.p50).padStart(7), String(r.p95).padStart(7), String(r.min).padStart(7), String(r.max).padStart(7), String(r.mean).padStart(7));
  }
  if (bytes.length) console.log('pdfBytes p50/p95:', percentile(bytes, 50), '/', percentile(bytes, 95));
  const failed = records.filter((r) => r.error);
  if (failed.length) console.log(`failures: ${failed.length} e.g. ${failed[0].error}`);
  return rows;
}

// Runs `CONCURRENCY` compiles at a time and reports both per-job latency and makespan.
async function runBatch() {
  const records = [];
  for (let i = 0; i < ITERATIONS; i++) {
    records.push(await runIteration(() => nonce()));
  }
  return records;
}

async function main() {
  await login();
  console.log(`bench ${LABEL} workload=${WORKLOAD} workspace=${WORKSPACE} iterations=${ITERATIONS} concurrency=${CONCURRENCY} base=${BASE}`);
  const batches = Array.from({ length: CONCURRENCY }, (_, i) => i);
  const t0 = Date.now();
  const results = await Promise.all(batches.map(() => runBatch()));
  const makespan = Date.now() - t0;
  const records = results.flat();
  const summary = summarize(records, `${LABEL} ${WORKLOAD}${WORKSPACE ? ' (workspace)' : ''}`);
  if (CONCURRENCY > 1) {
    console.log(`makespan=${makespan}ms for ${records.length} compiles, throughput=${((records.length / makespan) * 1000).toFixed(2)}/s`);
  }
  writeFileSync(OUT.replace(/\.jsonl$/, '-summary.json'), JSON.stringify({ label: LABEL, workload: WORKLOAD, workspace: WORKSPACE, iterations: ITERATIONS, concurrency: CONCURRENCY, poll: `${POLL_FIRST}:${POLL_INTERVAL}`, makespanMs: makespan, rows: summary, startedAt: start }, null, 2));
}

main().catch((error) => {
  console.error('BENCH FAILED:', error.message);
  process.exit(1);
});
