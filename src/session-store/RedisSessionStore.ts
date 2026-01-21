import { randomUUID } from "crypto";

import type {
  SerializableSessionData,
  SessionStore,
  SessionStoreOptions,
} from "./types.js";

/**
 * Minimal Redis client interface for dependency injection.
 * Compatible with ioredis.
 */
export interface RedisClient {
  del(key: string | string[]): Promise<number>;
  exists(key: string | string[]): Promise<number>;
  get(key: string): Promise<null | string>;
  pipeline(): RedisPipeline;
  quit(): Promise<string>;
  sadd(key: string, ...members: string[]): Promise<number>;
  set(
    key: string,
    value: string,
    expiryMode?: string,
    time?: number,
  ): Promise<null | string>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
}

/**
 * Redis connection options compatible with ioredis.
 */
export interface RedisConnectionOptions {
  [key: string]: unknown;
  db?: number;
  host?: string;
  password?: string;
  port?: number;
  tls?: object;
}

export interface RedisPipeline {
  del(key: string): RedisPipeline;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
  sadd(key: string, ...members: string[]): RedisPipeline;
  set(
    key: string,
    value: string,
    expiryMode?: string,
    time?: number,
  ): RedisPipeline;
  srem(key: string, ...members: string[]): RedisPipeline;
}

/**
 * Redis-specific options for the session store.
 */
export interface RedisSessionStoreOptions extends SessionStoreOptions {
  /**
   * Use an existing Redis client instance instead of creating a new one.
   * When provided, the store will not close the client on shutdown.
   */
  client?: RedisClient;

  /**
   * ioredis connection options or connection URL.
   * Examples:
   * - "redis://localhost:6379"
   * - "redis://:password@localhost:6379/0"
   * - { host: "localhost", port: 6379, password: "secret" }
   */
  redis: RedisConnectionOptions | string;
}

/**
 * Redis-based session store implementation.
 * Enables horizontal scaling by storing sessions in Redis.
 *
 * @example
 * ```typescript
 * import { RedisSessionStore } from "./session-store/RedisSessionStore.js";
 * import Redis from "ioredis";
 *
 * // Using connection URL
 * const store = new RedisSessionStore({
 *   redis: "redis://localhost:6379",
 *   ttlMs: 3600000,
 * });
 *
 * // Using existing client
 * const redis = new Redis();
 * const store = new RedisSessionStore({
 *   redis: {},
 *   client: redis,
 * });
 * ```
 */
export class RedisSessionStore<T = Record<string, unknown>>
  implements SessionStore<T>
{
  readonly #keyPrefix: string;
  readonly #options: RedisSessionStoreOptions;
  readonly #ownsClient: boolean;
  #redis: null | RedisClient = null;
  #redisPromise: null | Promise<RedisClient> = null;
  readonly #ttlSeconds: number;

  constructor(options: RedisSessionStoreOptions) {
    this.#options = options;
    this.#ownsClient = !options.client;
    this.#keyPrefix = options.keyPrefix ?? "fastmcp:session:";
    this.#ttlSeconds = Math.ceil((options.ttlMs ?? 3600000) / 1000);

    if (options.client) {
      this.#redis = options.client;
    }
  }

  async close(): Promise<void> {
    if (this.#ownsClient && this.#redis) {
      await this.#redis.quit();
      this.#redis = null;
    }
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
    const redis = await this.#getClient();
    const sessionId = randomUUID();
    const now = Date.now();

    const session: SerializableSessionData<T> = {
      ...data,
      createdAt: now,
      lastActivityAt: now,
      sessionId,
    };

    const key = this.#key(sessionId);
    const pipeline = redis.pipeline();

    // Store session data with TTL
    pipeline.set(key, JSON.stringify(session), "EX", this.#ttlSeconds);

    // Add to index set (for listing)
    pipeline.sadd(this.#indexKey(), sessionId);

    try {
      await pipeline.exec();
      return sessionId;
    } catch (error) {
      // Log error and rethrow - creation failure should be visible
      throw new Error(
        `Failed to create session in Redis: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    const redis = await this.#getClient();
    const pipeline = redis.pipeline();
    pipeline.del(this.#key(sessionId));
    pipeline.srem(this.#indexKey(), sessionId);

    try {
      const results = await pipeline.exec();
      return results?.[0]?.[1] === 1;
    } catch {
      // Log error and return false - deletion failure is non-critical
      return false;
    }
  }

  async get(sessionId: string): Promise<null | SerializableSessionData<T>> {
    const redis = await this.#getClient();
    const data = await redis.get(this.#key(sessionId));

    if (!data) {
      // Clean up index if session expired
      await redis.srem(this.#indexKey(), sessionId);
      return null;
    }

    try {
      return JSON.parse(data) as SerializableSessionData<T>;
    } catch {
      return null;
    }
  }

  async list(filter?: Partial<T>): Promise<string[]> {
    const redis = await this.#getClient();
    const sessionIds = await redis.smembers(this.#indexKey());

    if (!filter) {
      // Verify sessions still exist (clean up stale index entries)
      const validIds: string[] = [];
      for (const id of sessionIds) {
        const exists = await redis.exists(this.#key(id));
        if (exists) {
          validIds.push(id);
        } else {
          await redis.srem(this.#indexKey(), id);
        }
      }
      return validIds;
    }

    // Filter by auth properties
    const result: string[] = [];
    for (const id of sessionIds) {
      const session = await this.get(id);
      if (!session) {
        continue;
      }

      if (session.auth) {
        let matches = true;
        for (const [key, value] of Object.entries(filter)) {
          if ((session.auth as Record<string, unknown>)[key] !== value) {
            matches = false;
            break;
          }
        }
        if (matches) {
          result.push(id);
        }
      }
    }

    return result;
  }

  async touch(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) {
      return false;
    }

    const redis = await this.#getClient();
    session.lastActivityAt = Date.now();
    await redis.set(
      this.#key(sessionId),
      JSON.stringify(session),
      "EX",
      this.#ttlSeconds,
    );

    return true;
  }

  async update(
    sessionId: string,
    data: Partial<SerializableSessionData<T>>,
  ): Promise<boolean> {
    const redis = await this.#getClient();
    const existing = await this.get(sessionId);
    if (!existing) {
      return false;
    }

    const updated: SerializableSessionData<T> = {
      ...existing,
      ...data,
      lastActivityAt: Date.now(),
      sessionId, // Prevent sessionId from being changed
    };

    await redis.set(
      this.#key(sessionId),
      JSON.stringify(updated),
      "EX",
      this.#ttlSeconds,
    );

    return true;
  }

  /**
   * Lazily initialize the Redis client.
   * This allows the RedisSessionStore to be created without immediately
   * requiring ioredis to be installed.
   */
  async #getClient(): Promise<RedisClient> {
    if (this.#redis) {
      return this.#redis;
    }

    if (this.#redisPromise) {
      return this.#redisPromise;
    }

    this.#redisPromise = (async () => {
      // Dynamic import to make ioredis optional
      const ioredis = await import("ioredis");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Redis = ioredis.default as any;

      const redis =
        typeof this.#options.redis === "string"
          ? new Redis(this.#options.redis)
          : new Redis(this.#options.redis as RedisConnectionOptions);

      this.#redis = redis as RedisClient;
      return this.#redis;
    })();

    return this.#redisPromise;
  }

  #indexKey(): string {
    return `${this.#keyPrefix}index`;
  }

  #key(sessionId: string): string {
    return `${this.#keyPrefix}${sessionId}`;
  }
}
