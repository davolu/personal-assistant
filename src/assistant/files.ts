import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Local stand-in for object storage. S3/R2 is the extension behind the same methods. */
export interface BlobStore {
  put(userId: string, name: string, bytes: Buffer): Promise<string>;
  get(userId: string, id: string): Promise<Buffer | null>;
}

export class MemoryBlobStore implements BlobStore {
  private files = new Map<string, { userId: string; name: string; bytes: Buffer }>();
  async put(userId: string, name: string, bytes: Buffer) {
    const id = randomUUID();
    this.files.set(id, { userId, name, bytes });
    return id;
  }
  async get(userId: string, id: string) {
    const file = this.files.get(id);
    if (!file || file.userId !== userId) return null;
    return file.bytes;
  }
}

export class LocalBlobStore implements BlobStore {
  constructor(private root = join(process.cwd(), "data", "uploads")) {}
  async put(userId: string, name: string, bytes: Buffer) {
    const id = randomUUID();
    const dir = join(this.root, userId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, id), bytes);
    await writeFile(join(dir, `${id}.name`), name);
    return id;
  }
  async get(userId: string, id: string) {
    try {
      return await readFile(join(this.root, userId, id));
    } catch {
      return null;
    }
  }
}
