import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createExtension,
  errorResponse,
  jsonResponse,
} from '@jshookmcp/extension-sdk/plugin';
import type {
  PluginLifecycleContext,
  ToolArgs,
  ToolResponse,
} from '@jshookmcp/extension-sdk/plugin';

const PLUGIN_ID = 'io.github.vmoranv.android.smali-search';
const PLUGIN_VERSION = '0.0.1';
const TOOL_NAME = 'android_smali_search';

type JsonRecord = Record<string, unknown>;

function readTextContent(result: ToolResponse): string {
  const block = result.content.find(
    (item): item is { type: 'text'; text: string } =>
      item.type === 'text' && typeof item.text === 'string',
  );
  if (!block) throw new Error('Tool did not return text content');
  return block.text;
}

function parseToolPayload(result: ToolResponse): JsonRecord {
  const parsed = JSON.parse(readTextContent(result)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool did not return a JSON object');
  }
  return parsed as JsonRecord;
}

async function invokeJsonTool(
  ctx: PluginLifecycleContext,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  return parseToolPayload(await ctx.invokeTool(name, args));
}

async function walkFiles(root: string, matchers: RegExp[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (matchers.some((matcher) => matcher.test(entry.name))) {
        files.push(fullPath);
      }
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function handleSmaliSearch(args: ToolArgs, ctx: PluginLifecycleContext) {
  const apkPath = typeof args.apkPath === 'string' ? args.apkPath.trim() : '';
  const needle = typeof args.needle === 'string' ? args.needle.trim() : '';
  const maxMatches = typeof args.maxMatches === 'number' ? Math.max(1, Math.floor(args.maxMatches)) : 20;
  if (!apkPath) {
    return errorResponse(TOOL_NAME, new Error('apkPath is required'));
  }
  if (!needle) {
    return errorResponse(TOOL_NAME, new Error('needle is required'));
  }

  try {
    const decodePayload = await invokeJsonTool(ctx, 'apktool_decode', { apkPath, force: true });
    const outputDir = decodePayload.outputDir;
    if (typeof outputDir !== 'string' || outputDir.length === 0) {
      throw new Error('apktool_decode did not provide outputDir');
    }

    const candidateFiles = await walkFiles(outputDir, [/\.smali$/i, /\.xml$/i]);
    const findings: Array<{
      file: string;
      line: number;
      snippet: string;
    }> = [];

    for (const file of candidateFiles) {
      if (findings.length >= maxMatches) break;
      const content = await readFile(file, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (findings.length < maxMatches && line.toLowerCase().includes(needle.toLowerCase())) {
          findings.push({
            file,
            line: index + 1,
            snippet: line.trim(),
          });
        }
      });
    }

    return jsonResponse({
      success: true,
      apkPath,
      needle,
      decodedOutputDir: outputDir,
      scannedFileCount: candidateFiles.length,
      matchCount: findings.length,
      findings,
    });
  } catch (error) {
    return errorResponse(TOOL_NAME, error, { apkPath, needle });
  }
}

export default createExtension(PLUGIN_ID, PLUGIN_VERSION)
  .name('Android Smali Search')
  .description('Decode APKs with apktool and search smali/resources for analyst-supplied strings.')
  .author('vmoranv')
  .sourceRepo('https://github.com/vmoranv/jshook_plugin_android_smali_search')
  .compatibleCore('>=0.1.0')
  .profile(['workflow', 'full'])
  .allowTool('apktool_decode')
  .metric('android_smali_search_calls_total')
  .tool(
    TOOL_NAME,
    'Decode the APK via apktool and search smali/resources for a case-insensitive string.',
    {
      apkPath: {
        type: 'string',
        description: 'Absolute or relative path to the target APK file.',
      },
      needle: {
        type: 'string',
        description: 'Case-insensitive string to search for in decoded smali and XML files.',
      },
      maxMatches: {
        type: 'number',
        description: 'Maximum number of findings to return.',
      },
    },
    handleSmaliSearch,
  );
