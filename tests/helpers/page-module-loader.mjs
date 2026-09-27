import { readFileSync } from 'node:fs';

/** Load a dependency-free page module in Node tests while executing the same source used by the page. */
export async function loadPageModule(url, exportNames) {
  const source = readFileSync(url, 'utf8')
    .replace(/^export\s+(?=(?:function|const|let|class)\b)/gm, '');
  const executable = `${source}\nexport { ${exportNames.join(', ')} };`;
  const encoded = Buffer.from(executable).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}
