import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, options: { timeoutMs?: number; staleMs?: number } = {}): Promise<T> {
  const lock = path.resolve(lockPath);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 30_000;
  const start = Date.now();
  await fs.mkdir(path.dirname(lock), { recursive: true });
  while (true) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lock).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for file lock: ${lock}`);
      await sleep(25);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
