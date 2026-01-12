import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const exec = promisify(execCallback);

export interface CompilationResult {
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
  warnings?: string;
  duration: number;
}

export interface CompilationOptions {
  timeout?: number; 
  cleanupOnError?: boolean; 
}

/**
 * Compiles LaTeX content to PDF using Tectonic Docker
 * @param latexContent - The LaTeX source code as a string
 * @param filename - Base filename (without extension) for the output
 * @param options - Compilation options
 * @returns CompilationResult with PDF buffer or error information
 */
export async function compileLatexToPDF(
  latexContent: string,
  filename: string = 'document',
  options: CompilationOptions = {}
): Promise<CompilationResult> {
  const { timeout = 60000, cleanupOnError = true } = options;
  const startTime = Date.now();
  
  // Create unique temporary directory
  const tempDir = path.join(
    process.cwd(), 
    'temp', 
    `latex-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );
  const texPath = path.join(tempDir, `${filename}.tex`);
  const outputDir = path.join(tempDir, 'output');
  const pdfPath = path.join(outputDir, `${filename}.pdf`);

  try {
    // Create directories
    await fs.mkdir(outputDir, { recursive: true });
    
    // Write LaTeX content to file
    await fs.writeFile(texPath, latexContent, 'utf-8');
    console.log(`[LATEX] Created ${texPath}`);

    // Build Docker command
    const dockerCmd = [
      'docker', 'run', '--rm',
      '--dns', '8.8.8.8',
      '--dns', '8.8.4.4',
      '-v', `${tempDir}:/tex:Z`,
      '-w', '/tex',
      'dxjoke/tectonic-docker:latest',
      'tectonic', '--outdir', 'output', `${filename}.tex`
    ].join(' ');

    console.log(`[LATEX] Compiling ${filename}.tex`);
    
    // Execute compilation
    const { stdout, stderr } = await exec(dockerCmd, { timeout });
    
    const duration = Date.now() - startTime;
    console.log(`[LATEX] Compilation completed in ${duration}ms`);

    // Small delay for filesystem sync
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify PDF was created
    await fs.access(pdfPath);

    // Read PDF
    const pdfBuffer = await fs.readFile(pdfPath);
    console.log(`[LATEX] PDF generated: ${pdfBuffer.length} bytes`);

    // Cleanup temporary files
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`[LATEX] Cleaned up ${tempDir}`);

    return {
      success: true,
      pdfBuffer,
      warnings: stderr.trim() || undefined,
      duration,
    };

  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    // Cleanup on error if requested
    if (cleanupOnError) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(`[LATEX] Cleaned up ${tempDir} after error`);
      } catch (cleanupError) {
        console.error('[LATEX] Cleanup failed:', cleanupError);
      }
    }

    console.error('[LATEX] Compilation failed:', error.message);

    return {
      success: false,
      error: error.stderr || error.message || 'Unknown compilation error',
      duration,
    };
  }
}

/**
 * Validates LaTeX content for basic syntax
 * @param content - LaTeX content to validate
 * @returns Object with isValid boolean and error message if invalid
 */
export function validateLatexContent(content: string): { 
  isValid: boolean; 
  error?: string;
} {
  if (!content || content.trim().length === 0) {
    return { isValid: false, error: 'LaTeX content is empty' };
  }

  // Check for document class
  if (!content.includes('\\documentclass')) {
    return { 
      isValid: false, 
      error: 'Missing \\documentclass declaration' 
    };
  }

  // Check for begin document
  if (!content.includes('\\begin{document}')) {
    return { 
      isValid: false, 
      error: 'Missing \\begin{document}' 
    };
  }

  // Check for end document
  if (!content.includes('\\end{document}')) {
    return { 
      isValid: false, 
      error: 'Missing \\end{document}' 
    };
  }

  // Check for balanced braces (basic check)
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    return { 
      isValid: false, 
      error: 'Unbalanced braces in LaTeX content' 
    };
  }

  return { isValid: true };
}