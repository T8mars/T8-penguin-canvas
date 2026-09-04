import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const TYPESCRIPT_MODULE_PATTERN = /\.[cm]?tsx?$/i;
const JSON_MODULE_PATTERN = /\.json$/i;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND'
      || (!specifier.startsWith('./') && !specifier.startsWith('../'))
      || /\.[a-z0-9]+$/i.test(specifier)) throw error;
    const base = new URL(specifier, context.parentURL);
    for (const extension of ['.ts', '.tsx', '.mts', '.cts']) {
      const candidate = new URL(`${base.href}${extension}`);
      try {
        await access(fileURLToPath(candidate));
        return { url: candidate.href, shortCircuit: true };
      } catch {
        // Try the next TypeScript extension.
      }
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && JSON_MODULE_PATTERN.test(new URL(url).pathname)) {
    const source = await readFile(new URL(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${source.trim()};\n`,
    };
  }
  if (!url.startsWith('file:') || !TYPESCRIPT_MODULE_PATTERN.test(new URL(url).pathname)) {
    return nextLoad(url, context);
  }

  const source = await readFile(new URL(url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: new URL(url).pathname,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      sourceMap: true,
      inlineSources: true,
    },
  });

  return {
    format: 'module',
    shortCircuit: true,
    source: output.outputText,
  };
}
