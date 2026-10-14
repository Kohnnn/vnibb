import { readFileSync } from 'fs';
import path from 'path';
import {
  MCP_PROMPT_CATALOG,
  MCP_RESOURCE_CATALOG,
  MCP_TOOL_CATALOG,
} from '@/lib/mcpToolCatalog';

/**
 * The frontend catalog is a static mirror of the python MCP server surface.
 * It silently drifted twice: the doc inventory listed 18 of 20 registered
 * tools and this catalog carried 16 of 20. These guards read the server source
 * and fail on any mismatch instead of re-pinning a hardcoded list.
 */
const SERVER_SOURCE = path.resolve(__dirname, '../../../../../apps/api/vnibb/mcp/server.py');

function serverNames(kind: 'tool' | 'prompt'): Set<string> {
  const source = readFileSync(SERVER_SOURCE, 'utf8');
  const matches = source.matchAll(
    new RegExp(`@mcp\\.${kind}\\([^\\n]*\\)\\s*\\n(?:async\\s+)?def\\s+(\\w+)`, 'g'),
  );
  return new Set(Array.from(matches, (match) => match[1]));
}

function serverResourceUris(): Set<string> {
  const source = readFileSync(SERVER_SOURCE, 'utf8');
  const matches = source.matchAll(/@mcp\.resource\("([^"]+)"\)/g);
  return new Set(Array.from(matches, (match) => match[1]));
}

describe('MCP catalog mirrors the server surface', () => {
  it('lists every registered tool and no retired ones', () => {
    expect(new Set(MCP_TOOL_CATALOG.map((tool) => tool.name))).toEqual(serverNames('tool'));
  });

  it('lists every registered prompt', () => {
    expect(new Set(MCP_PROMPT_CATALOG.map((prompt) => prompt.name))).toEqual(serverNames('prompt'));
  });

  it('lists every registered resource uri', () => {
    expect(new Set(MCP_RESOURCE_CATALOG.map((resource) => resource.uri))).toEqual(serverResourceUris());
  });

  it('never advertises a mutating permission class', () => {
    expect(MCP_TOOL_CATALOG.every((tool) => tool.permission !== 'confirm_action')).toBe(true);
  });
});
