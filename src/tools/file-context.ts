/**
 * File Context Tools - Smart File Reading for Agent Context Management
 *
 * Problem: Claude CLI agents read entire files into context, quickly consuming
 * their ~200k token window. Large files (like index.html at 12k+ lines) can
 * use 30-50k tokens per read.
 *
 * Solution: MCP tools that provide context-aware file access:
 * 1. file-info: Get file stats + token estimate before reading
 * 2. file-read-smart: Read files with automatic chunking/summarization
 * 3. file-split-work: Analyze files and recommend task distribution
 *
 * Usage: Agents should use these tools instead of raw file reads when
 * working with large files or coordinating multi-agent work.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { estimateTokens } from '../toon.js';

// ============================================================================
// Configuration
// ============================================================================

const FILE_CONTEXT_CONFIG = {
  // Token thresholds
  smallFileTokens: 2000,      // Files under this are safe to read fully
  mediumFileTokens: 8000,     // Files under this need chunking
  largeFileTokens: 20000,     // Files over this need summarization

  // Chunk sizes
  defaultChunkLines: 200,     // Lines per chunk for medium files
  summaryChunkLines: 500,     // Lines per chunk for large file summaries

  // Context budget recommendations
  maxTokensPerAgent: 50000,   // Recommended max file content per agent
  splitThreshold: 30000,      // Recommend splitting work above this
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Estimate tokens for a file without reading entire content
 */
async function estimateFileTokens(filePath: string): Promise<{
  tokens: number;
  lines: number;
  bytes: number;
  category: 'small' | 'medium' | 'large' | 'huge';
}> {
  const stats = await fs.stat(filePath);
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n').length;
  const tokens = estimateTokens(content);

  let category: 'small' | 'medium' | 'large' | 'huge';
  if (tokens < FILE_CONTEXT_CONFIG.smallFileTokens) {
    category = 'small';
  } else if (tokens < FILE_CONTEXT_CONFIG.mediumFileTokens) {
    category = 'medium';
  } else if (tokens < FILE_CONTEXT_CONFIG.largeFileTokens) {
    category = 'large';
  } else {
    category = 'huge';
  }

  return { tokens, lines, bytes: stats.size, category };
}

/**
 * Get file structure overview (functions, classes, sections)
 */
async function getFileStructure(filePath: string): Promise<{
  type: string;
  sections: Array<{ name: string; startLine: number; endLine: number; tokens: number }>;
}> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const ext = path.extname(filePath).toLowerCase();

  const sections: Array<{ name: string; startLine: number; endLine: number; tokens: number }> = [];

  // Detect file type and parse structure
  let type = 'unknown';

  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    type = 'typescript/javascript';
    // Find functions, classes, exports
    const patterns = [
      /^(export\s+)?(async\s+)?function\s+(\w+)/,
      /^(export\s+)?class\s+(\w+)/,
      /^(export\s+)?const\s+(\w+)\s*=/,
      /^(export\s+)?interface\s+(\w+)/,
      /^\/\/\s*={5,}/,  // Section comments
    ];

    let currentSection: { name: string; startLine: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          // Close previous section
          if (currentSection) {
            const sectionContent = lines.slice(currentSection.startLine - 1, i).join('\n');
            sections.push({
              name: currentSection.name,
              startLine: currentSection.startLine,
              endLine: i,
              tokens: estimateTokens(sectionContent)
            });
          }

          // Start new section
          const name = match[3] || match[2] || `Section at line ${i + 1}`;
          currentSection = { name, startLine: i + 1 };
          break;
        }
      }
    }

    // Close final section
    if (currentSection) {
      const sectionContent = lines.slice(currentSection.startLine - 1).join('\n');
      sections.push({
        name: currentSection.name,
        startLine: currentSection.startLine,
        endLine: lines.length,
        tokens: estimateTokens(sectionContent)
      });
    }
  } else if (['.html', '.htm'].includes(ext)) {
    type = 'html';
    // Find major sections by comments or tags
    const sectionPattern = /<!--\s*=+\s*(.+?)\s*=*\s*-->|<(style|script|head|body|main|header|footer|nav|section)/i;

    let currentSection: { name: string; startLine: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(sectionPattern);
      if (match) {
        if (currentSection) {
          const sectionContent = lines.slice(currentSection.startLine - 1, i).join('\n');
          sections.push({
            name: currentSection.name,
            startLine: currentSection.startLine,
            endLine: i,
            tokens: estimateTokens(sectionContent)
          });
        }
        currentSection = { name: match[1] || match[2] || `Section at ${i + 1}`, startLine: i + 1 };
      }
    }

    if (currentSection) {
      const sectionContent = lines.slice(currentSection.startLine - 1).join('\n');
      sections.push({
        name: currentSection.name,
        startLine: currentSection.startLine,
        endLine: lines.length,
        tokens: estimateTokens(sectionContent)
      });
    }
  } else if (['.css', '.scss', '.less'].includes(ext)) {
    type = 'css';
    // Find major CSS sections by comments
    const sectionPattern = /\/\*\s*=+\s*(.+?)\s*=*\s*\*\/|\/\*\s*(.+?)\s*\*\//;

    let currentSection: { name: string; startLine: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(sectionPattern);
      if (match && (match[1] || match[2])) {
        if (currentSection) {
          const sectionContent = lines.slice(currentSection.startLine - 1, i).join('\n');
          sections.push({
            name: currentSection.name,
            startLine: currentSection.startLine,
            endLine: i,
            tokens: estimateTokens(sectionContent)
          });
        }
        currentSection = { name: match[1] || match[2], startLine: i + 1 };
      }
    }

    if (currentSection) {
      const sectionContent = lines.slice(currentSection.startLine - 1).join('\n');
      sections.push({
        name: currentSection.name,
        startLine: currentSection.startLine,
        endLine: lines.length,
        tokens: estimateTokens(sectionContent)
      });
    }
  }

  // If no sections found, create chunks
  if (sections.length === 0) {
    const chunkSize = FILE_CONTEXT_CONFIG.defaultChunkLines;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const endLine = Math.min(i + chunkSize, lines.length);
      const chunkContent = lines.slice(i, endLine).join('\n');
      sections.push({
        name: `Lines ${i + 1}-${endLine}`,
        startLine: i + 1,
        endLine,
        tokens: estimateTokens(chunkContent)
      });
    }
  }

  return { type, sections };
}

/**
 * Generate work split recommendations
 */
function generateSplitRecommendation(
  filePath: string,
  totalTokens: number,
  sections: Array<{ name: string; startLine: number; endLine: number; tokens: number }>,
  targetAgents?: number
): {
  shouldSplit: boolean;
  reason: string;
  agents: number;
  assignments: Array<{ agent: number; sections: string[]; totalTokens: number; lineRange: string }>;
} {
  if (totalTokens < FILE_CONTEXT_CONFIG.splitThreshold && !targetAgents) {
    return {
      shouldSplit: false,
      reason: `File is ${totalTokens} tokens, under split threshold of ${FILE_CONTEXT_CONFIG.splitThreshold}`,
      agents: 1,
      assignments: [{
        agent: 1,
        sections: sections.map(s => s.name),
        totalTokens,
        lineRange: `1-${sections[sections.length - 1]?.endLine || 0}`
      }]
    };
  }

  // Calculate optimal agent count
  const targetTokensPerAgent = FILE_CONTEXT_CONFIG.maxTokensPerAgent;
  const agents = targetAgents || Math.ceil(totalTokens / targetTokensPerAgent);

  // Distribute sections to agents
  const tokensPerAgent = Math.ceil(totalTokens / agents);
  const assignments: Array<{ agent: number; sections: string[]; totalTokens: number; lineRange: string }> = [];
  let currentAgent = 1;
  let currentTokens = 0;
  let currentSections: string[] = [];
  let startLine = 1;

  for (const section of sections) {
    if (currentTokens + section.tokens > tokensPerAgent && currentSections.length > 0 && currentAgent < agents) {
      assignments.push({
        agent: currentAgent,
        sections: currentSections,
        totalTokens: currentTokens,
        lineRange: `${startLine}-${section.startLine - 1}`
      });
      currentAgent++;
      currentTokens = 0;
      currentSections = [];
      startLine = section.startLine;
    }

    currentSections.push(section.name);
    currentTokens += section.tokens;
  }

  // Add final assignment
  if (currentSections.length > 0) {
    assignments.push({
      agent: currentAgent,
      sections: currentSections,
      totalTokens: currentTokens,
      lineRange: `${startLine}-${sections[sections.length - 1].endLine}`
    });
  }

  return {
    shouldSplit: true,
    reason: `File is ${totalTokens} tokens. Splitting across ${assignments.length} agents keeps each under ${tokensPerAgent} tokens.`,
    agents: assignments.length,
    assignments
  };
}

// ============================================================================
// Tool Registration
// ============================================================================

export function registerFileContextTools(server: McpServer): void {

  // ============================================================================
  // FILE-INFO TOOL
  // ============================================================================

  server.tool(
    'file-info',
    'Get file statistics and token estimate BEFORE reading. Shows size category (small/medium/large/huge), structure breakdown, and recommendations. Use this to plan context usage before reading large files.',
    {
      filePath: z.string().describe('Absolute path to the file')
    },
    async ({ filePath }) => {
      try {
        const info = await estimateFileTokens(filePath);
        const structure = await getFileStructure(filePath);

        const result = {
          path: filePath,
          ...info,
          structure: {
            type: structure.type,
            sectionCount: structure.sections.length,
            sections: structure.sections.slice(0, 20).map(s => ({
              name: s.name,
              lines: `${s.startLine}-${s.endLine}`,
              tokens: s.tokens
            }))
          },
          recommendation: info.category === 'small'
            ? 'Safe to read fully'
            : info.category === 'medium'
            ? 'Consider reading specific sections with file-read-smart'
            : info.category === 'large'
            ? 'Use file-read-smart with section/lineRange params'
            : 'Split work across agents with file-split-work'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }]
        };
      }
    }
  );

  // ============================================================================
  // FILE-READ-SMART TOOL
  // ============================================================================

  server.tool(
    'file-read-smart',
    'Read file content with context-aware chunking. Read specific sections by name, line ranges, or apply token caps. Use instead of raw file reads for large files to conserve context.',
    {
      filePath: z.string().describe('Absolute path to the file'),
      section: z.string().optional().describe('Read specific section by name (from file-info)'),
      startLine: z.number().optional().describe('Start reading from this line number'),
      endLine: z.number().optional().describe('Stop reading at this line number'),
      maxTokens: z.number().optional().describe('Maximum tokens to return (truncates if exceeded)')
    },
    async ({ filePath, section, startLine, endLine, maxTokens }) => {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const info = await estimateFileTokens(filePath);

        let selectedContent: string;
        let selectedLines: { start: number; end: number };

        if (section) {
          // Read by section name
          const structure = await getFileStructure(filePath);
          const found = structure.sections.find(s =>
            s.name.toLowerCase().includes(section.toLowerCase())
          );

          if (found) {
            selectedContent = lines.slice(found.startLine - 1, found.endLine).join('\n');
            selectedLines = { start: found.startLine, end: found.endLine };
          } else {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                error: `Section "${section}" not found`,
                availableSections: structure.sections.map(s => s.name)
              }, null, 2) }]
            };
          }
        } else if (startLine !== undefined) {
          // Read by line range
          const start = Math.max(1, startLine) - 1;
          const end = endLine ? Math.min(lines.length, endLine) : lines.length;
          selectedContent = lines.slice(start, end).join('\n');
          selectedLines = { start: start + 1, end };
        } else {
          // Read full file (with max token cap)
          selectedContent = content;
          selectedLines = { start: 1, end: lines.length };
        }

        // Apply token cap if specified
        const selectedTokens = estimateTokens(selectedContent);
        const cap = maxTokens || FILE_CONTEXT_CONFIG.maxTokensPerAgent;

        if (selectedTokens > cap) {
          // Truncate to fit token budget
          const ratio = cap / selectedTokens;
          const linesToKeep = Math.floor((selectedLines.end - selectedLines.start + 1) * ratio);
          const truncatedLines = selectedContent.split('\n').slice(0, linesToKeep);
          selectedContent = truncatedLines.join('\n');
          selectedContent += `\n\n... [TRUNCATED: ${selectedTokens - estimateTokens(selectedContent)} more tokens. Use section/lineRange params for full content]`;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            path: filePath,
            lines: selectedLines,
            tokens: estimateTokens(selectedContent),
            totalFileTokens: info.tokens,
            content: selectedContent
          }, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }]
        };
      }
    }
  );

  // ============================================================================
  // FILE-SPLIT-WORK TOOL
  // ============================================================================

  server.tool(
    'file-split-work',
    'Analyze a file and recommend how to split work across multiple agents. Returns optimal agent count, section assignments, and line ranges for each agent. Use for coordinating multi-agent work on large files.',
    {
      filePath: z.string().describe('Absolute path to the file'),
      targetAgents: z.number().optional().describe('Force distribution across this many agents')
    },
    async ({ filePath, targetAgents }) => {
      try {
        const info = await estimateFileTokens(filePath);
        const structure = await getFileStructure(filePath);
        const recommendation = generateSplitRecommendation(filePath, info.tokens, structure.sections, targetAgents);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            path: filePath,
            totalTokens: info.tokens,
            category: info.category,
            fileType: structure.type,
            sectionCount: structure.sections.length,
            ...recommendation,
            usage: recommendation.shouldSplit
              ? `Spawn ${recommendation.agents} agents. Each should use file-read-smart with their assigned lineRange.`
              : 'Single agent can handle this file safely.'
          }, null, 2) }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }]
        };
      }
    }
  );
}

// Export tool definitions for documentation
export const fileContextToolDefinitions = [
  {
    name: 'file-info',
    description: 'Get file statistics and token estimate before reading. Shows file size category, structure breakdown, and reading recommendations.'
  },
  {
    name: 'file-read-smart',
    description: 'Read file content with context-aware chunking. Can read specific sections by name, line ranges, or apply token caps.'
  },
  {
    name: 'file-split-work',
    description: 'Analyze a file and recommend how to split work across multiple agents. Returns optimal agent count and section assignments.'
  }
];
