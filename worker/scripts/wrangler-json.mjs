// Wrangler's remote SQL file upload reports progress before its JSON result.
export function parseWranglerJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    const lines = output.split(/\r?\n/);
    for (let index = 1; index < lines.length; index++) {
      if (lines[index].trim() !== '[') continue;
      try {
        const result = JSON.parse(lines.slice(index).join('\n'));
        if (Array.isArray(result)) return result;
      } catch {
        // A progress line can contain brackets; keep looking for a full result.
      }
    }
    throw new Error('Wrangler did not return valid JSON; database operation may have completed.');
  }
}
