import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  InitInputSchema,
  SearchCodeInputSchema,
  SearchFilesInputSchema,
  SearchSymbolsInputSchema,
  IndexStatusInputSchema,
  ReindexInputSchema,
  IndexUpdateInputSchema,
} from "./tools/schemas.js";
import { handleInit } from "./tools/init.js";
import { handleSearchCode } from "./tools/search-code.js";
import { handleSearchFiles } from "./tools/search-files.js";
import { handleSearchSymbols } from "./tools/search-symbols.js";
import { handleIndexStatus } from "./tools/index-status.js";
import { handleReindex } from "./tools/reindex.js";
import { handleIndexUpdate } from "./tools/index-update.js";
import { logger } from "./utils/logger.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "vectordb-search",
    version: "0.1.0",
  });

  server.tool(
    "init",
    "Initialize or rebuild the vector index for a project. Scans all code files, parses them into semantic chunks, generates embeddings, and stores them in a local vector database for fast semantic search. Run this once per project, or after major changes.",
    InitInputSchema.shape,
    async (args) => {
      logger.info("Tool called: init", { projectPath: args.projectPath });
      const result = await handleInit(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "search_code",
    "Search for code snippets using natural language. Returns relevant code chunks with file paths, line numbers, and similarity scores. Use this to find implementations, patterns, or logic without knowing exact names.",
    SearchCodeInputSchema.shape,
    async (args) => {
      logger.info("Tool called: search_code", { query: args.query });
      const result = await handleSearchCode(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "search_files",
    "Find relevant files using natural language description. Returns file paths ranked by semantic relevance. Use this to discover which files relate to a concept or feature.",
    SearchFilesInputSchema.shape,
    async (args) => {
      logger.info("Tool called: search_files", { query: args.query });
      const result = await handleSearchFiles(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "search_symbols",
    "Search for functions, classes, methods, types, and other code symbols by name or description. Returns symbol definitions with signatures and locations.",
    SearchSymbolsInputSchema.shape,
    async (args) => {
      logger.info("Tool called: search_symbols", { query: args.query });
      const result = await handleSearchSymbols(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "index_status",
    "Show statistics about the current vector index: number of indexed files, chunks, symbols, embedding provider, and last indexing time.",
    IndexStatusInputSchema.shape,
    async (args) => {
      logger.info("Tool called: index_status", { projectPath: args.projectPath });
      const result = await handleIndexStatus(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "reindex",
    "Force a complete rebuild of the vector index. Deletes all existing data and re-indexes everything from scratch. Use when the index seems corrupted or after changing embedding settings.",
    ReindexInputSchema.shape,
    async (args) => {
      logger.info("Tool called: reindex", { projectPath: args.projectPath });
      const result = await handleReindex(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "index_update",
    "Incrementally update the vector index. Detects changed, new, and deleted files since the last indexing, and updates only those entries. Much faster than a full reindex.",
    IndexUpdateInputSchema.shape,
    async (args) => {
      logger.info("Tool called: index_update", { projectPath: args.projectPath });
      const result = await handleIndexUpdate(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  return server;
}
