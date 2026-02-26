import { readdirSync, statSync } from 'node:fs';

function validateMarkdownFiles(baseDir, checks = []) {
  const stack = [baseDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
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

      checks.push(full);
    }
  }

  return checks;
}

const found = validateMarkdownFiles('.');

if (found.length === 0) {
  console.log('No markdown files found.');
  process.exit(0);
}

console.log(`Found ${found.length} markdown files.`);
found.forEach((file) => console.log(`- ${file}`));
process.exit(0);
