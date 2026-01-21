import { randomUUID } from "crypto";

import type {
  SerializableSessionData,
  SessionStore,
  SessionStoreOptions,
} from "./types.js";

/**
 * In-memory session store implementation.
 * Suitable for single-instance deployments or development.
 * Sessions are lost when the process restarts.
 */
export class MemorySessionStore<T = Record<string, unknown>>
  implements SessionStore<T>
{
  #cleanupInterval: null | ReturnType<typeof setInterval> = null;
  readonly #sessions: Map<string, SerializableSessionData<T>> = new Map();
  readonly #ttlMs: number;

  constructor(options: SessionStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 3600000; // 1 hour default

    // Periodic cleanup of expired sessions
    // Run cleanup at half TTL or every minute, whichever is smaller
    const cleanupIntervalMs = Math.min(this.#ttlMs / 2, 60000);
    this.#cleanupInterval = setInterval(() => {
      this.#cleanupExpired();
    }, cleanupIntervalMs);

    // Don't keep the process alive just for cleanup
    if (this.#cleanupInterval.unref) {
      this.#cleanupInterval.unref();
    }
  }

  async close(): Promise<void> {
    if (this.#cleanupInterval) {
      clearInterval(this.#cleanupInterval);
      this.#cleanupInterval = null;
    }
    this.#sessions.clear();
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  async create(
    data: Omit<
      SerializableSessionData<T>,
      "createdAt" | "lastActivityAt" | "sessionId"
    >,
  ): Promise<string> {
    const sessionId = randomUUID();
    const now = Date.now();

    const session: SerializableSessionData<T> = {
      ...data,
      createdAt: now,
      lastActivityAt: now,
      sessionId,
    };

    this.#sessions.set(sessionId, session);
    return sessionId;
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.#sessions.delete(sessionId);
  }

  async get(sessionId: string): Promise<null | SerializableSessionData<T>> {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check TTL
    if (Date.now() - session.lastActivityAt > this.#ttlMs) {
      this.#sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  async list(filter?: Partial<T>): Promise<string[]> {
    const now = Date.now();
    const result: string[] = [];

    for (const [id, session] of this.#sessions) {
      // Skip expired sessions
      if (now - session.lastActivityAt > this.#ttlMs) {
        continue;
      }

      // Apply filter if provided
      if (filter && session.auth) {
        let matches = true;
        for (const [key, value] of Object.entries(filter)) {
          if ((session.auth as Record<string, unknown>)[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) {
          continue;
        }
      }

      result.push(id);
    }

    return result;
  }

  async touch(sessionId: string): Promise<boolean> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Check if already expired
    if (Date.now() - session.lastActivityAt > this.#ttlMs) {
      this.#sessions.delete(sessionId);
      return false;
    }

    session.lastActivityAt = Date.now();
    return true;
  }

  async update(
    sessionId: string,
    data: Partial<SerializableSessionData<T>>,
  ): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) {
      return false;
    }

    const updated: SerializableSessionData<T> = {
      ...session,
      ...data,
      lastActivityAt: Date.now(),
      sessionId, // Prevent sessionId from being changed
    };

    this.#sessions.set(sessionId, updated);
    return true;
  }

  #cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.#sessions) {
      if (now - session.lastActivityAt > this.#ttlMs) {
        this.#sessions.delete(id);
      }
    }
  }
}
