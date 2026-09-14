import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";
import type { ChunkRecord, FileRecord, ProjectMetadata } from "./schema.js";
import { getLanceDbPath, getMetadataPath, ensureDir } from "../utils/paths.js";
import { readFile, writeFile } from "fs/promises";
import { logger } from "../utils/logger.js";

export class VectorDB {
  private connection: Connection | null = null;
  private chunksTable: Table | null = null;
  private filesTable: Table | null = null;
  private projectPath: string;
  private dimensions: number;

  constructor(projectPath: string, dimensions: number) {
    this.projectPath = projectPath;
    this.dimensions = dimensions;
  }

  async connect(): Promise<void> {
    const dbPath = getLanceDbPath(this.projectPath);
    await ensureDir(dbPath);
    this.connection = await lancedb.connect(dbPath);
    logger.info("LanceDB connected", { path: dbPath });
  }

  async close(): Promise<void> {
    this.connection = null;
    this.chunksTable = null;
    this.filesTable = null;
  }

  private getConnection(): Connection {
    if (!this.connection) throw new Error("Database not connected");
    return this.connection;
  }

  async getOrCreateChunksTable(initialData?: ChunkRecord[]): Promise<Table> {
    if (this.chunksTable) return this.chunksTable;

    const conn = this.getConnection();
    const tableNames = await conn.tableNames();

    if (tableNames.includes("chunks")) {
      this.chunksTable = await conn.openTable("chunks");
    } else if (initialData && initialData.length > 0) {
      this.chunksTable = await conn.createTable("chunks", initialData);
    } else {
      // Create with empty placeholder
      const empty: ChunkRecord = {
        id: "__placeholder__",
        vector: new Array(this.dimensions).fill(0),
        filePath: "",
        startLine: 0,
        endLine: 0,
        content: "",
        symbolName: "",
        symbolType: "",
        language: "",
        parentSymbol: "",
        summary: "",
        fileHash: "",
        indexedAt: new Date().toISOString(),
      };
      this.chunksTable = await conn.createTable("chunks", [empty]);
    }
    return this.chunksTable;
  }

  async getOrCreateFilesTable(initialData?: FileRecord[]): Promise<Table> {
    if (this.filesTable) return this.filesTable;

    const conn = this.getConnection();
    const tableNames = await conn.tableNames();

    if (tableNames.includes("files")) {
      this.filesTable = await conn.openTable("files");
    } else if (initialData && initialData.length > 0) {
      this.filesTable = await conn.createTable("files", initialData);
    } else {
      const empty: FileRecord = {
        filePath: "__placeholder__",
        vector: new Array(this.dimensions).fill(0),
        language: "",
        fileHash: "",
        chunkCount: 0,
        symbolCount: 0,
        indexedAt: new Date().toISOString(),
      };
      this.filesTable = await conn.createTable("files", [empty]);
    }
    return this.filesTable;
  }

  async dropAllTables(): Promise<void> {
    const conn = this.getConnection();
    const tableNames = await conn.tableNames();
    for (const name of tableNames) {
      await conn.dropTable(name);
    }
    this.chunksTable = null;
    this.filesTable = null;
    logger.info("All tables dropped");
  }

  async saveMetadata(metadata: ProjectMetadata): Promise<void> {
    const metaPath = getMetadataPath(this.projectPath);
    await ensureDir(metaPath.replace(/[/\\][^/\\]+$/, ""));
    await writeFile(metaPath, JSON.stringify(metadata, null, 2));
  }

  async loadMetadata(): Promise<ProjectMetadata | null> {
    try {
      const metaPath = getMetadataPath(this.projectPath);
      const raw = await readFile(metaPath, "utf-8");
      return JSON.parse(raw) as ProjectMetadata;
    } catch {
      return null;
    }
  }
}
