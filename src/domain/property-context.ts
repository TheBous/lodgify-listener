export type PropertySections = Record<string, string>;

/** Appends FAQ / playbook markdown to the base property manual (used by triage and autoreply). */
export function mergePropertyContextMarkdown(base: string, appendix: string): string {
  const extra = appendix.trim();
  if (!extra) return base;
  if (!base.trim()) return extra;
  return `${base.trimEnd()}\n\n${extra}\n`;
}

export function parsePropertySections(markdown: string): PropertySections {
  const sections: PropertySections = {};
  let current: { title: string; body: string[] } | null = null;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^## (.+)$/);
    if (heading?.[1]) {
      flush(sections, current);
      current = { title: heading[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush(sections, current);
  return sections;
}

function flush(sections: PropertySections, current: { title: string; body: string[] } | null) {
  if (!current) return;
  const body = current.body.join("\n").trim();
  if (body) sections[current.title] = body;
}
