import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { LineChunker } from "../../src/chunking/line-chunker.js";
import { VectorDB } from "../../src/db/connection.js";
import { Indexer, type IndexResult } from "../../src/indexing/indexer.js";
import { ProjectConfigSchema } from "../../src/config/schema.js";
import { getProjectDbPath } from "../../src/utils/paths.js";

const DIMS = 16;

async function realRows(table: Awaited<ReturnType<VectorDB["getOrCreateChunksTable"]>>) {
  const rows = await table.query().limit(10_000).toArray();
  return rows.filter((r) => r.id !== "__placeholder__" && r.filePath !== "__placeholder__");
}

describe("Integration: Indexer.fullIndex when another process recreates the tables", () => {
  const config = ProjectConfigSchema.parse({ files: { include: ["**/*.ts"], gitOnly: false } });
  let projectPath: string;
  let db: VectorDB;
  let result: IndexResult;

  beforeAll(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-fullindex-"));
    const lines = (tag: string) =>
      Array.from({ length: 25 }, (_, i) => `export const ${tag}${i} = ${i};`).join("\n");
    await writeFile(join(projectPath, "a.ts"), lines("a"));
    await writeFile(join(projectPath, "b.ts"), lines("b"));

    db = new VectorDB(projectPath, DIMS);
    await db.connect();

    // A second connection stands in for another MCP server process that looks up the
    // index while fullIndex is still embedding (after dropAllTables) and creates
    // empty placeholder tables.
    const otherProcess = new VectorDB(projectPath, DIMS);
    await otherProcess.connect();
    const embedder = new MockEmbeddingProvider(DIMS);
    const embedBatch = embedder.embedBatch.bind(embedder);
    let interfered = false;
    embedder.embedBatch = async (texts: string[]) => {
      if (!interfered) {
        interfered = true;
        await otherProcess.getOrCreateChunksTable();
        await otherProcess.getOrCreateFilesTable();
      }
      return embedBatch(texts);
    };

    result = await new Indexer(projectPath, db, embedder, new LineChunker(10, 0), config).fullIndex();
    expect(interfered).toBe(true);
  });

  afterAll(async () => {
    await db.close();
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  // Read through a fresh connection so the assertions see what was actually persisted
  async function freshReader(): Promise<VectorDB> {
    const reader = new VectorDB(projectPath, DIMS);
    await reader.connect();
    return reader;
  }

  it("stores every chunk it reports", async () => {
    const rows = await realRows(await (await freshReader()).getOrCreateChunksTable());

    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(rows).toHaveLength(result.chunksCreated);
  });

  it("stores every file it reports", async () => {
    const rows = await realRows(await (await freshReader()).getOrCreateFilesTable());

    expect(rows).toHaveLength(result.filesIndexed);
  });
});
