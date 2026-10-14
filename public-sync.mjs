import { readFile, writeFile, mkdir } from 'node:fs/promises';

const source = process.env.SOURCE_URL || 'https://xiaodu-design-weekly.xbccb.chatgpt.site/api/issues';
const response = await fetch(source, { headers: { accept: 'application/json' } });
if (!response.ok) throw new Error(`Weekly source returned ${response.status}`);
const issues = await response.json();
if (!Array.isArray(issues) || !issues.length) throw new Error('Weekly source returned no issues');
issues.sort((a, b) => b.start.localeCompare(a.start));
await mkdir('data', { recursive: true });
await writeFile('issues.json', JSON.stringify(issues, null, 2));
const embedded = JSON.stringify(issues).replaceAll('<', '\\u003c');
for (const file of ['index.html', '404.html']) {
  const html = await readFile(file, 'utf8');
  const next = html.replace(/(<script type="application\/json" id="issues-data">)[\s\S]*?(<\/script>)/, `$1${embedded}$2`);
  if (next === html) throw new Error(`Could not update embedded data in ${file}`);
  await writeFile(file, next);
}
console.log(`Synced ${issues.length} weekly issue(s)`);
