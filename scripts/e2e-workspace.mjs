#!/usr/bin/env node
// End-to-end workspace compile check against a running dev server and worker.
//
//   node scripts/e2e-workspace.mjs --base http://127.0.0.1:3000
//
// Exercises the real HTTP API, the real Redis queue, the real worker and the real
// Tectonic engine. Exits non-zero with the failed assertion on the first problem.

import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { makePng } from './bench/fixtures.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const BASE = flag('base', process.env.BENCH_BASE || 'http://127.0.0.1:3000');
const OUT = flag('out', '/tmp/e2e-workspace');
const TIMEOUT_MS = Number(flag('timeout', 120000));

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let cookie = '';
const results = [];
const nonce = () => `e${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ name, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' :: ' + String(detail).slice(0, 300)}`);
  if (!ok) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(1);
  }
}

async function api(p, init = {}, withCookie = true) {
  const headers = {
    ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(withCookie && cookie ? { Cookie: typeof withCookie === 'string' ? withCookie : cookie } : {}),
    ...(init.headers || {}),
  };
  const res = await fetch(`${BASE}${p}`, { ...init, headers });
  const type = res.headers.get('content-type') || '';
  let data;
  if (type === 'application/pdf' || type.startsWith('image/')) data = Buffer.from(await res.arrayBuffer());
  else {
    const text = await res.text();
    data = text && type.includes('json') ? JSON.parse(text) : text;
  }
  return { status: res.status, data, headers: res.headers };
}

async function otherUserCookie() {
  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET && existsSync('.env')) loadEnvFile('.env');
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Cross-user check needs AUTH_SECRET or NEXTAUTH_SECRET');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let id;
  try {
    const email = 'e2e-workspace-other@runes-ai.test';
    await client.query('INSERT INTO users (id, email, "firstName", "lastName", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, NOW(), NOW()) ON CONFLICT (email) DO NOTHING', [randomUUID(), email, 'Other', 'Test']);
    id = (await client.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
  } finally {
    await client.end();
  }
  const data = Buffer.from(JSON.stringify({
    id,
    email: 'e2e-workspace-other@runes-ai.test',
    name: 'Other test user',
    picture: null,
    issuedAt: Date.now(),
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `dev-session=${data}.${signature}`;
}

function expectApi(res, expected, what) {
  check(what, res.status === expected, `expected ${expected}, got ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
}

async function login() {
  const res = await fetch(`${BASE}/api/dev-login`, { method: 'POST' });
  check('dev login', res.ok, `dev-login status ${res.status}`);
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  cookie = raw.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  check('dev login cookie', cookie.includes('dev-session'), cookie.slice(0, 40));
}

async function createDocument(title, content) {
  const res = await api('/api/document', { method: 'POST', body: JSON.stringify({ title, content }) });
  expectApi(res, 201, `create document ${title}`);
  return res.data;
}

async function write(slug, p, content, baseRevision = null) {
  return api(`/api/document/${slug}/file`, {
    method: 'PUT',
    body: JSON.stringify(baseRevision === null ? { path: p, content } : { path: p, content, baseRevision }),
  });
}

async function compile(slug) {
  const res = await api(`/api/document/${slug}`, { method: 'POST' });
  return res;
}

async function wait(jobId) {
  const started = Date.now();
  for (;;) {
    const res = await api(`/api/job/${jobId}`);
    if (res.status !== 200) throw new Error(`job status ${res.status}: ${JSON.stringify(res.data)}`);
    const status = res.data;
    if (status.status === 'completed' || status.status === 'failed') return status;
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`job ${jobId} did not finish in ${TIMEOUT_MS}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function pdf(jobId) {
  const res = await api(`/api/pdf/${jobId}`);
  if (res.status !== 200) throw new Error(`pdf status ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.data;
}

const png = makePng(240, 160);

const MAIN = (marker) => [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\usepackage{amsmath}',
  `\\title{Workspace ${marker}}`,
  '\\begin{document}',
  '\\maketitle',
  '\\input{chapters/methods}',
  '\\input{chapters/results}',
  `Cross references: section~\\ref{sec:methods}, equation~\\ref{eq:loss}, figure~\\ref{fig:plot}.`,
  '\\bibliographystyle{plain}',
  '\\bibliography{refs}',
  '\\end{document}',
  '',
].join(String.fromCharCode(10));

const BIB = (marker) => [
  `@article{curve${marker},`,
  '  author  = {A. Researcher},',
  `  title   = {Curve Fitting ${marker}},`,
  '  journal = {Journal of Benchmarking},',
  '  year    = {2026}',
  '}',
  '',
].join(String.fromCharCode(10));

const METHODS = `\\section{Methods}
\\label{sec:methods}
We minimise a loss.
\\begin{equation}
\\label{eq:loss}
L = \\sum_i (y_i - \\hat{y}_i)^2
\\end{equation}
`;

const RESULTS = (marker) => `\\section{Results}
\\label{sec:results}
As shown in section~\\ref{sec:methods} and equation~\\ref{eq:loss}, the fit works
\\cite{curve${marker}}.
\\begin{figure}[h]
\\includegraphics{figures/plot.png}
\\caption{A plot}
\\label{fig:plot}
\\end{figure}
`;

async function buildWorkspace(marker) {
  const doc = await createDocument(`ws ${marker}`, 'placeholder');
  const slug = doc.slug;
  let res = await write(slug, 'main.tex', MAIN(marker));
  expectApi(res, 200, 'write main.tex');
  expectApi(await write(slug, 'chapters/methods.tex', METHODS), 201, 'create chapters/methods.tex');
  expectApi(await write(slug, 'chapters/results.tex', RESULTS(marker)), 201, 'create chapters/results.tex');

  expectApi(await write(slug, 'refs.bib', BIB(marker)), 201, 'create refs.bib');

  const form = new FormData();
  form.append('path', 'figures/plot.png');
  form.append('file', new Blob([png], { type: 'image/png' }), 'plot.png');
  const up = await api(`/api/document/${slug}/upload`, { method: 'POST', body: form });
  expectApi(up, 201, 'upload figures/plot.png');
  check('uploaded asset is stored as image kind', up.data.file.kind === 'image', JSON.stringify(up.data.file));

  expectApi(await api(`/api/document/${slug}/main`, { method: 'POST', body: JSON.stringify({ path: 'main.tex' }) }), 200, 'select main file');
  return slug;
}

async function main() {
  await login();

  // 1. Legacy single source documents keep working and become a main.tex workspace.
  const legacyContent = `\\documentclass{article}\n\\begin{document}\nLegacy body ${nonce()}\n\\end{document}\n`;
  const legacy = await createDocument(`legacy ${nonce()}`, legacyContent);
  const legacyRead = await api(`/api/document/${legacy.slug}`);
  expectApi(legacyRead, 200, 'read legacy document');
  check('legacy URL still returns the document', legacyRead.data.document.slug === legacy.slug);
  check('legacy content column is byte identical', legacyRead.data.document.content === legacyContent, JSON.stringify(legacyRead.data.document.content));
  check('legacy document gained main.tex', legacyRead.data.document.mainFilePath === 'main.tex', legacyRead.data.document.mainFilePath);
  check('migration created exactly one file', legacyRead.data.document.files.length === 1, JSON.stringify(legacyRead.data.document.files));
  check('document id and slug are unchanged', legacyRead.data.document.id === legacy.id);

  const legacyCompile = await compile(legacy.slug);
  expectApi(legacyCompile, 202, 'compile legacy document');
  const legacyStatus = await wait(legacyCompile.data.jobId);
  check('legacy document still compiles', legacyStatus.status === 'completed', JSON.stringify(legacyStatus.result));
  const legacyPdf = await pdf(legacyCompile.data.jobId);
  check('legacy pdf downloaded', legacyPdf.subarray(0, 5).toString() === '%PDF-', legacyPdf.length);

  // 2. Real nested workspace with includes, an image and a bibliography.
  const marker = nonce();
  const slug = await buildWorkspace(marker);
  const first = await compile(slug);
  expectApi(first, 202, 'compile workspace');
  const snapshotPaths = first.data.snapshot.files.map((f) => f.path).sort();
  check('snapshot holds the transitive closure', JSON.stringify(snapshotPaths) === JSON.stringify(['chapters/methods.tex', 'chapters/results.tex', 'figures/plot.png', 'main.tex', 'refs.bib']), JSON.stringify(snapshotPaths));
  const firstStatus = await wait(first.data.jobId);
  check('workspace compile completed', firstStatus.status === 'completed', JSON.stringify(firstStatus.result));
  const log = firstStatus.result.logExcerpt || '';
  check('no undefined cross-file references', !/undefined/i.test(log), log.slice(-400));
  check('no missing files reported by the engine', !/not found|No such file/i.test(log), log.slice(-300));
  check('stage timings are recorded', typeof firstStatus.timings?.queueWaitMs === 'number' && typeof firstStatus.timings?.compiler?.engineMs === 'number', JSON.stringify(firstStatus.timings));
  const firstPdf = await pdf(first.data.jobId);
  check('workspace pdf downloaded', firstPdf.subarray(0, 5).toString() === '%PDF-', firstPdf.length);
  check('pdf embeds the figure (larger than a text only build)', firstPdf.length > 12000, firstPdf.length);
  check('pdf is stored at a job url', first.data.snapshot.digest.length === 64);

  // 3. The same bytes must not compile twice.
  const tRepeat = Date.now();
  const repeat = await compile(slug);
  expectApi(repeat, 202, 'recompile identical snapshot');
  check('identical snapshot reuses the finished job', repeat.data.reused === 'completed', JSON.stringify(repeat.data).slice(0, 160));
  check('reused compile keeps the same job id', repeat.data.jobId === first.data.jobId);
  check('reused compile answers quickly', Date.now() - tRepeat < 500, Date.now() - tRepeat);
  const repeatPdf = await pdf(repeat.data.jobId);
  check('reused pdf is byte identical', repeatPdf.equals(firstPdf));

  // 4. Editing a file the main file does not reference must not invalidate the PDF.
  expectApi(await write(slug, 'notes/draft.tex', '\\section{Draft}\nUnreferenced notes.\n'), 201, 'create unreferenced file');
  const unreferenced = await compile(slug);
  check('unreferenced file does not change the digest', unreferenced.data.reused === 'completed' && unreferenced.data.jobId === first.data.jobId, JSON.stringify(unreferenced.data).slice(0, 160));

  // 5. Editing a referenced file must invalidate the cached PDF.
  expectApi(await write(slug, 'chapters/methods.tex', METHODS + '\nExtra paragraph with more words to change the page count.\n'.repeat(60)), 200, 'edit referenced chapter');
  const invalidated = await compile(slug);
  check('editing a referenced file invalidates the cache', invalidated.data.reused === 'new' && invalidated.data.jobId !== first.data.jobId, JSON.stringify(invalidated.data).slice(0, 160));
  const invalidatedStatus = await wait(invalidated.data.jobId);
  check('edited workspace recompiles', invalidatedStatus.status === 'completed', JSON.stringify(invalidatedStatus.result));
  const grownPdf = await pdf(invalidated.data.jobId);
  check('recompiled pdf differs from the cached one', !grownPdf.equals(firstPdf), `${grownPdf.length} vs ${firstPdf.length}`);

  // 6. Snapshot consistency: an edit after enqueue cannot change the running job.
  const isoSlug = await buildWorkspace(`iso${marker}`);
  const before = await compile(isoSlug);
  const beforeStatus = await wait(before.data.jobId);
  check('isolation baseline compile', beforeStatus.status === 'completed', JSON.stringify(beforeStatus.result));
  const beforePdf = await pdf(before.data.jobId);

  const during = await compile(isoSlug);
  expectApi(during, 202, 'enqueue compile then edit');
  expectApi(await write(isoSlug, 'chapters/methods.tex', METHODS + '\n\\section{Late edit}\n' + 'Inserted after the job was queued. '.repeat(120)), 200, 'edit while compiling');
  const duringStatus = await wait(during.data.jobId);
  check('job that was running still completes', duringStatus.status === 'completed', JSON.stringify(duringStatus.result));
  check('running job kept the pre-edit snapshot', duringStatus.snapshot.digest === before.data.snapshot.digest, `${duringStatus.snapshot.digest} vs ${before.data.snapshot.digest}`);
  const duringPdf = await pdf(during.data.jobId);
  check('running job pdf equals the pre-edit pdf', duringPdf.equals(beforePdf), `${duringPdf.length} vs ${beforePdf.length}`);
  const afterEdit = await compile(isoSlug);
  check('post edit compile is a new digest', afterEdit.data.reused === 'new' && afterEdit.data.jobId !== during.data.jobId, JSON.stringify(afterEdit.data).slice(0, 160));
  await wait(afterEdit.data.jobId);
  const afterEditPdf = await pdf(afterEdit.data.jobId);
  check('post edit pdf is different', !afterEditPdf.equals(duringPdf), `${afterEditPdf.length}`);

  // 7. Missing include is reported with the referencing file, before any engine time.
  const brokenSlug = await buildWorkspace(`miss${marker}`);
  expectApi(await write(brokenSlug, 'main.tex', MAIN(`miss${marker}`) + '\n\\input{chapters/ghost}\n'), 200, 'reference a missing chapter');
  const missing = await compile(brokenSlug);
  expectApi(missing, 422, 'compile with a missing include');
  check('missing reference names the file', missing.data.missing?.[0]?.file === 'main.tex', JSON.stringify(missing.data));
  check('missing reference names the target', String(missing.data.missing?.[0]?.reference).includes('chapters/ghost'), JSON.stringify(missing.data.missing));

  // 8. A TeX error inside an included file reports that file and line.
  const errSlug = await buildWorkspace(`err${marker}`);
  const errorLine = 4;
  expectApi(await write(errSlug, 'chapters/results.tex', '\\section{Broken}\n\\label{sec:broken}\nText\n\\begin{tabular}{\\undefinedmacro}\nbroken content\n\\end{tabular}\n'), 200, 'write broken chapter');
  const failed = await compile(errSlug);
  expectApi(failed, 202, 'compile broken workspace');
  const failedStatus = await wait(failed.data.jobId);
  check('broken workspace fails', failedStatus.status === 'failed', JSON.stringify(failedStatus.result).slice(0, 200));
  const diagnostics = failedStatus.result.diagnostics || [];
  const inChapter = diagnostics.find((d) => d.file === 'chapters/results.tex');
  check('diagnostic points at the included file', Boolean(inChapter), JSON.stringify(diagnostics).slice(0, 400));
  check('diagnostic has a line number', typeof inChapter?.line === 'number' && inChapter.line >= errorLine - 1, JSON.stringify(inChapter));

  // 9. Path validation and unsupported types.
  const guardSlug = await buildWorkspace(`guard${marker}`);
  for (const bad of ['../../etc/passwd.tex', '/etc/passwd.tex', 'a/../b.tex', './x.tex', 'figures//x.tex', '\uff0e\uff0e/etc.tex', 'C:/windows/x.tex', 'x'.repeat(320) + '.tex']) {
    const res = await write(guardSlug, bad, 'x');
    check(`rejects path ${JSON.stringify(bad).slice(0, 30)}`, res.status === 400, `status ${res.status}`);
  }
  const unsupported = await write(guardSlug, 'payload.exe', 'MZ');
  check('rejects unsupported extension', unsupported.status === 415, `status ${unsupported.status}`);
  const oversize = await write(guardSlug, 'big.tex', '%\\documentclass{article}\n' + 'x'.repeat(1024 * 1024 + 10));
  check('rejects oversized text file', oversize.status === 413 || oversize.status === 400, `status ${oversize.status}`);
  const emptyUpload = new FormData();
  emptyUpload.append('path', 'figures/empty.png');
  emptyUpload.append('file', new Blob([]), 'empty.png');
  const empty = await api(`/api/document/${guardSlug}/upload`, { method: 'POST', body: emptyUpload });
  check('rejects empty upload', empty.status === 400, `status ${empty.status}`);

  // 10. File operations: rename, move, delete rules, main pointer, asset serving.
  const opsSlug = await buildWorkspace(`ops${marker}`);
  const renamed = await api(`/api/document/${opsSlug}/move`, { method: 'POST', body: JSON.stringify({ from: 'chapters/methods.tex', to: 'text/methods.tex' }) });
  expectApi(renamed, 200, 'move a chapter to another folder');
  const afterMove = await api(`/api/document/${opsSlug}`);
  check('moved file appears at the new path', afterMove.data.document.files.some((f) => f.path === 'text/methods.tex'));
  check('moved file is gone from the old path', !afterMove.data.document.files.some((f) => f.path === 'chapters/methods.tex'));
  const movedCompile = await compile(opsSlug);
  expectApi(movedCompile, 422, 'moving an included file breaks the include loudly');
  check('stale include is reported after the move', String(JSON.stringify(movedCompile.data)).includes('chapters/methods'), JSON.stringify(movedCompile.data).slice(0, 200));
  const deleteMain = await api(`/api/document/${opsSlug}/file?path=main.tex`, { method: 'DELETE' });
  check('cannot delete the main file', deleteMain.status === 409, `status ${deleteMain.status}`);
  expectApi(await api(`/api/document/${opsSlug}/main`, { method: 'POST', body: JSON.stringify({ path: 'figures/plot.png' }) }), 415, 'main file must be a tex file');
  const asset = await api(`/api/document/${opsSlug}/asset?path=figures/plot.png`);
  expectApi(asset, 200, 'read figure asset');
  check('asset bytes match the upload', Buffer.compare(asset.data, png) === 0, `${asset.data.length} vs ${png.length}`);
  check('asset content type is png', asset.headers.get('content-type') === 'image/png', asset.headers.get('content-type'));
  const dup = await write(opsSlug, 'TEXT/METHODS.TEX', 'case collision');
  check('rejects a path that differs only by case', dup.status === 409, `status ${dup.status}`);
  const conflict = await write(opsSlug, 'text/methods.tex', 'stale write', 1);
  check('stale baseRevision is rejected', conflict.status === 409, `status ${conflict.status}`);
  const fresh = await api(`/api/document/${opsSlug}/file?path=text/methods.tex`);
  expectApi(fresh, 200, 'read a nested file');
  check('file read returns revision and checksum', typeof fresh.data.file.revision === 'number' && fresh.data.file.checksum.length === 64, JSON.stringify(fresh.data.file).slice(0, 150));
  expectApi(await api(`/api/document/${opsSlug}/file?path=text/methods.tex`, { method: 'DELETE' }), 200, 'delete a nested file');
  check('deleted file is gone', !(await api(`/api/document/${opsSlug}`)).data.document.files.some((f) => f.path === 'text/methods.tex'));

  // 11. Unauthenticated access is refused on every workspace surface.
  const anonPaths = [
    `/api/document/${guardSlug}`,
    `/api/document/${guardSlug}/file?path=main.tex`,
    `/api/document/${guardSlug}/asset?path=figures/plot.png`,
  ];
  for (const p of anonPaths) {
    const res = await api(p, {}, false);
    check(`anonymous denied ${p.split('/').pop()}`, res.status === 401, `status ${res.status}`);
  }
  const anonCompile = await api(`/api/document/${guardSlug}`, { method: 'POST' }, false);
  check('anonymous cannot queue a compile', anonCompile.status === 401, `status ${anonCompile.status}`);
  const anonJob = await api(`/api/job/${first.data.jobId}`, {}, false);
  check('anonymous cannot read a job', anonJob.status === 401, `status ${anonJob.status}`);
  const anonPdf = await api(`/api/pdf/${first.data.jobId}`, {}, false);
  check('anonymous cannot read a pdf', anonPdf.status === 401, `status ${anonPdf.status}`);

  const aiRequests = [
    ['/api/chat', { documentId: legacy.id, message: 'Improve the prose' }],
    ['/api/ai/complete', { documentId: legacy.id, prefix: 'Legacy body', suffix: '' }],
    ['/api/ai/paraphrase', { documentId: legacy.id, selectedText: 'Legacy body', before: ' ', after: ' ' }],
  ];
  for (const [path, body] of aiRequests) {
    const res = await api(path, { method: 'POST', body: JSON.stringify(body) }, false);
    check(`anonymous denied ${path}`, res.status === 401, `status ${res.status}`);
  }

  // A valid session for a different user must not expose owned resources.
  const otherCookie = await otherUserCookie();
  const ownedPaths = [
    `/api/document/${guardSlug}`,
    `/api/document/${guardSlug}/file?path=main.tex`,
    `/api/document/${guardSlug}/asset?path=figures/plot.png`,
    `/api/job/${first.data.jobId}`,
    `/api/pdf/${first.data.jobId}`,
  ];
  for (const p of ownedPaths) {
    const res = await api(p, {}, otherCookie);
    check(`other user denied ${p.split('/').pop()}`, res.status === 404, `status ${res.status}`);
  }
  const otherCompile = await api(`/api/document/${guardSlug}`, { method: 'POST' }, otherCookie);
  check('other user cannot queue a compile', otherCompile.status === 404, `status ${otherCompile.status}`);
  const otherWrite = await api(`/api/document/${guardSlug}/file`, {
    method: 'PUT', body: JSON.stringify({ path: 'main.tex', content: 'overwritten' }),
  }, otherCookie);
  check('other user cannot edit a file', otherWrite.status === 404, `status ${otherWrite.status}`);
  for (const [path, body] of aiRequests) {
    const res = await api(path, { method: 'POST', body: JSON.stringify(body) }, otherCookie);
    check(`other user denied ${path}`, res.status === 404, `status ${res.status}`);
  }

  // Check the remaining workspace mutations, including routes that do not
  // return document bytes. A failed delete must leave the document intact.
  const guardedPath = `/api/document/${guardSlug}`;
  const uploadForm = () => {
    const form = new FormData();
    form.append('path', 'figures/forbidden.png');
    form.append('file', new Blob([png], { type: 'image/png' }), 'forbidden.png');
    return form;
  };
  const mutationRequests = [
    ['update document', () => ({ path: guardedPath, init: { method: 'PUT', body: JSON.stringify({ title: 'Taken over' }) } })],
    ['patch document', () => ({ path: guardedPath, init: { method: 'PATCH', body: JSON.stringify({ title: 'Taken over' }) } })],
    ['delete document', () => ({ path: guardedPath, init: { method: 'DELETE' } })],
    ['delete file', () => ({ path: `${guardedPath}/file?path=chapters/methods.tex`, init: { method: 'DELETE' } })],
    ['move file', () => ({ path: `${guardedPath}/move`, init: { method: 'POST', body: JSON.stringify({ from: 'chapters/methods.tex', to: 'chapters/stolen.tex' }) } })],
    ['select main file', () => ({ path: `${guardedPath}/main`, init: { method: 'POST', body: JSON.stringify({ path: 'chapters/methods.tex' }) } })],
    ['upload file', () => ({ path: `${guardedPath}/upload`, init: { method: 'POST', body: uploadForm() } })],
  ];
  for (const [label, auth, expected] of [['anonymous', false, 401], ['other user', otherCookie, 404]]) {
    for (const [action, request] of mutationRequests) {
      const { path, init } = request();
      expectApi(await api(path, init, auth), expected, `${label} cannot ${action}`);
    }
  }
  const guarded = await api(guardedPath);
  expectApi(guarded, 200, 'owner retains document after denied mutations');
  check('denied mutations leave title and main file unchanged', guarded.data.document.title !== 'Taken over' && guarded.data.document.mainFilePath === 'main.tex');
  check('denied mutations leave workspace files unchanged', guarded.data.document.files.some((f) => f.path === 'chapters/methods.tex') && !guarded.data.document.files.some((f) => f.path === 'chapters/stolen.tex' || f.path === 'figures/forbidden.png'));

  // Markdown assets have separate list, upload, byte-serving and delete routes.
  const markdown = await api('/api/document', {
    method: 'POST', body: JSON.stringify({ title: `assets ${nonce()}`, format: 'MARKDOWN' }),
  });
  expectApi(markdown, 201, 'create Markdown asset boundary document');
  const assetsPath = `/api/document/${markdown.data.slug}/assets`;
  const assetForm = () => {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'boundary.png');
    return form;
  };
  const assetUpload = await api(assetsPath, { method: 'POST', body: assetForm() });
  expectApi(assetUpload, 201, 'upload Markdown boundary asset');
  const assetPath = assetUpload.data.asset.url;
  expectApi(await api(assetsPath), 200, 'owner lists Markdown assets');
  const ownerAsset = await api(assetPath);
  expectApi(ownerAsset, 200, 'owner downloads Markdown asset');
  check('Markdown asset bytes match upload', ownerAsset.data.equals(png));

  for (const [label, auth, expected] of [['anonymous', false, 401], ['other user', otherCookie, 404]]) {
    expectApi(await api(assetsPath, {}, auth), expected, `${label} cannot list Markdown assets`);
    expectApi(await api(assetsPath, { method: 'POST', body: assetForm() }, auth), expected, `${label} cannot upload Markdown assets`);
    expectApi(await api(assetPath, {}, auth), expected, `${label} cannot download Markdown assets`);
    expectApi(await api(assetPath, { method: 'DELETE' }, auth), expected, `${label} cannot delete Markdown assets`);
  }
  expectApi(await api(assetPath, { method: 'DELETE' }), 200, 'owner deletes Markdown asset');
  check('deleted Markdown asset cannot be downloaded', (await api(assetPath)).status === 404);
  expectApi(await api(`/api/document/${markdown.data.slug}`, { method: 'DELETE' }), 200, 'delete Markdown boundary document');

  // 12. Autosave of unchanged bytes must not create a new compile.
  const idemSlug = await buildWorkspace(`idem${marker}`);
  const idemFirst = await compile(idemSlug);
  const idemFirstStatus = await wait(idemFirst.data.jobId);
  check('idempotency baseline compile', idemFirstStatus.status === 'completed');
  const mainBefore = await api(`/api/document/${idemSlug}/file?path=main.tex`);
  expectApi(await write(idemSlug, 'main.tex', mainBefore.data.file.content, mainBefore.data.file.revision), 200, 'rewrite identical main.tex');
  const mainAfter = await api(`/api/document/${idemSlug}/file?path=main.tex`);
  check('identical write does not bump the revision', mainAfter.data.file.revision === mainBefore.data.file.revision, `${mainBefore.data.file.revision} -> ${mainAfter.data.file.revision}`);
  const idemSecond = await compile(idemSlug);
  check('autosave of unchanged source reuses the pdf', idemSecond.data.jobId === idemFirst.data.jobId, JSON.stringify(idemSecond.data).slice(0, 150));

  console.log(`\n${results.length} assertions passed. Artifacts in ${OUT}`);
}

main().catch((error) => {
  console.error('E2E FAILED:', error.message);
  process.exit(1);
});
