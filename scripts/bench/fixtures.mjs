import zlib from 'node:zlib';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

// Deterministic 240x180 RGB gradient PNG with no external image dependency.
export function makePng(width = 240, height = 180) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      raw[offset++] = Math.round((x / width) * 255);
      raw[offset++] = Math.round((y / height) * 255);
      raw[offset++] = Math.round(((x + y) / (width + height)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const preamble = (title) => [
  '\\documentclass{article}',
  '\\usepackage[utf8]{inputenc}',
  '\\usepackage{amsmath}',
  '\\usepackage{graphicx}',
  '\\usepackage{cite}',
  `\\title{${title}}`,
  '\\author{Benchmark}',
  '\\begin{document}',
  '\\maketitle',
  '',
].join('\n');

const paragraphs = (seed, count) => Array.from({ length: count }, (_, i) => [
  `Benchmark ${seed} paragraph ${i + 1}. The quick brown fox jumps over the lazy dog while the`,
  `typesetter measures how long repeated prose takes to reach a PDF page. Sentence`,
  `${i * 3 + 1}, ${i * 3 + 2} and ${i * 3 + 3} keep the line length realistic for a paper.`,
].join(' ')).join('\n\n');

export const FIGURE_PATH = 'figures/plot.png';

export function smallSource(marker) {
  return [
    preamble('Small Benchmark Document'),
    '\\section{Introduction}',
    `Benchmark marker ${marker}. This short paragraph measures end to end compile latency.`,
    '\\begin{equation}',
    '  \\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
    '\\end{equation}',
    '\\end{document}',
    '',
  ].join('\n');
}

const methodsChapter = (marker) => [
  '\\section{Methods}\\label{sec:methods}',
  paragraphs(marker, 6),
  '',
  '\\input{chapters/details}',
  '',
].join('\n');

const detailsChapter = (marker) => [
  '\\subsection{Implementation Details}\\label{sec:details}',
  paragraphs(`${marker}-details`, 4),
  '',
].join('\n');

const resultsChapter = (marker) => [
  '\\section{Results}\\label{sec:results}',
  paragraphs(`${marker}-results`, 5),
  'As shown in Figure~\\ref{fig:plot}, the measured curve follows Equation~\\eqref{eq:fit}',
  'starting on page~\\pageref{sec:methods}, and Section~\\ref{sec:details} explains the setup.',
  '\\begin{figure}[h]',
  '  \\centering',
  `  \\includegraphics[width=0.6\\textwidth]{${FIGURE_PATH}}`,
  '  \\caption{Measured compile latency.}\\label{fig:plot}',
  '\\end{figure}',
  '\\begin{equation}\\label{eq:fit}',
  '  y = \\beta_0 + \\beta_1 x + \\varepsilon',
  '\\end{equation}',
  'Researcher and Typesetter studied this effect in detail.\\cite{runesBenchmark}',
  '',
].join('\n');

const bibFile = (marker) => [
  '@article{runesBenchmark,',
  '  author  = {A. Researcher and B. Typesetter},',
  `  title   = {On the Latency of Web LaTeX Compilation (${marker})},`,
  '  journal = {Journal of Benchmarking},',
  '  year    = {2026},',
  '  volume  = {12},',
  '  pages   = {1--14}',
  '}',
  '',
].join('\n');

// Multi-file workspace fixture: main file plus nested includes, figure and bibliography.
export function projectFiles(marker) {
  return {
    'main.tex': [
      preamble('Workspace Benchmark Project'),
      '\\section{Introduction}',
      `Benchmark marker ${marker}. See Section~\\ref{sec:methods} and Figure~\\ref{fig:plot}.`,
      '\\input{chapters/methods}',
      '\\input{chapters/results}',
      '\\section{Conclusion}',
      `The conclusion returns to Section~\\ref{sec:results} and cites previous work.\\cite{runesBenchmark}`,
      '\\bibliographystyle{plain}',
      '\\bibliography{refs}',
      '\\end{document}',
      '',
    ].join('\n'),
    'chapters/methods.tex': methodsChapter(marker),
    'chapters/details.tex': detailsChapter(marker),
    'chapters/results.tex': resultsChapter(marker),
    'refs.bib': bibFile(marker),
  };
}

// Single-source equivalent of the same TeX work, for measuring the pre-workspace pipeline
// where one Document.content string is all that exists and no figure file can be uploaded.
export function projectFlattenedSource(marker) {
  return [
    preamble('Workspace Benchmark Project'),
    '\\section{Introduction}',
    `Benchmark marker ${marker}. See Section~\\ref{sec:methods}.`,
    methodsChapter(marker).replace('\\input{chapters/details}\n', ''),
    detailsChapter(marker),
    resultsChapter(marker)
      .replace(`  \\includegraphics[width=0.6\\textwidth]{${FIGURE_PATH}}`, '  \\rule{0.6\\textwidth}{4cm}')
      .replace('\\cite{runesBenchmark}', ''),
    '\\end{document}',
    '',
  ].join('\n');
}
