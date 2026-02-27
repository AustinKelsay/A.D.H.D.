import { readdirSync } from 'node:fs';
import path from 'node:path';

function collectMarkdownFiles(baseDir, files = []) {
  const stack = [baseDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git'].includes(entry.name)) {
          continue;
        }
        stack.push(full);
        continue;
      }

      if (!entry.name.endsWith('.md')) {
        continue;
      }

      files.push(full);
    }
  }

  return files;
}

const found = collectMarkdownFiles('.');

if (found.length === 0) {
  console.log('No markdown files found.');
  process.exit(0);
}

console.log(`Found ${found.length} markdown files.`);
for (const file of found) {
  console.log(`- ${file}`);
}

// TODO: implement markdown lint checks (link validation, frontmatter/schema checks, and heading formatting).
console.log(
  'Docs lint placeholder: placeholder discovery check only. Full markdown lint checks are pending in a follow-up task.',
);
process.exit(0);
