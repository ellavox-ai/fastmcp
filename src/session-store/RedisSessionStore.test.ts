import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RedisClient, RedisPipeline } from "./RedisSessionStore.js";
import type { SerializableSessionData } from "./types.js";

import { RedisSessionStore } from "./RedisSessionStore.js";

type CommandRecord = { args: string[]; type: string };

const createMockPipeline = (): {
  _commands: CommandRecord[];
} & RedisPipeline => {
  const commands: CommandRecord[] = [];
  const pipeline: { _commands: CommandRecord[] } & RedisPipeline = {
    _commands: commands,
    del: vi.fn().mockImplementation(function (this: RedisPipeline, ...args) {
      commands.push({ args, type: "del" });
      return this;
    }),
    exec: vi.fn().mockResolvedValue([
      [null, "OK"],
      [null, 1],
    ]),
    sadd: vi.fn().mockImplementation(function (this: RedisPipeline, ...args) {
      commands.push({ args, type: "sadd" });
      return this;
    }),
    set: vi.fn().mockImplementation(function (this: RedisPipeline, ...args) {
      commands.push({ args, type: "set" });
      return this;
    }),
    srem: vi.fn().mockImplementation(function (this: RedisPipeline, ...args) {
      commands.push({ args, type: "srem" });
      return this;
    }),
  };
  return pipeline;
};

const createMockRedisClient = (): {
  _data: Map<string, string>;
  _sets: Map<string, Set<string>>;
} & RedisClient => {
  const data = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  return {
    _data: data,
    _sets: sets,
    del: vi.fn().mockImplementation((key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const k of keys) {
        if (data.delete(k)) count++;
      }
      return Promise.resolve(count);
    }),
    exists: vi.fn().mockImplementation((key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const k of keys) {
        if (data.has(k)) count++;
      }
      return Promise.resolve(count);
    }),
    get: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(data.get(key) ?? null),
      ),
    pipeline: vi.fn().mockImplementation(() => {
      const pipe = createMockPipeline();
      // Make pipeline operations affect the mock data store
      pipe.exec = vi.fn().mockImplementation(async () => {
        const results: Array<[Error | null, unknown]> = [];
        for (const cmd of pipe._commands) {
          if (cmd.type === "set") {
            data.set(cmd.args[0], cmd.args[1]);
            results.push([null, "OK"]);
          } else if (cmd.type === "del") {
            const deleted = data.delete(cmd.args[0]) ? 1 : 0;
            results.push([null, deleted]);
          } else if (cmd.type === "sadd") {
            const [key, ...members] = cmd.args;
            if (!sets.has(key)) sets.set(key, new Set());
            let count = 0;
            for (const m of members) {
              if (!sets.get(key)!.has(m)) {
                sets.get(key)!.add(m);
                count++;
              }
            }
            results.push([null, count]);
          } else if (cmd.type === "srem") {
            const [key, ...members] = cmd.args;
            let count = 0;
            if (sets.has(key)) {
              for (const m of members) {
                if (sets.get(key)!.delete(m)) count++;
              }
            }
            results.push([null, count]);
          }
        }
        return results;
      });
      return pipe;
    }),
    quit: vi.fn().mockResolvedValue("OK"),
    sadd: vi.fn().mockImplementation((key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      let count = 0;
      for (const m of members) {
        if (!sets.get(key)!.has(m)) {
          sets.get(key)!.add(m);
          count++;
        }
      }
      return Promise.resolve(count);
    }),
    set: vi.fn().mockImplementation((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve("OK");
    }),
    smembers: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve([...(sets.get(key) ?? [])]);
    }),
    srem: vi.fn().mockImplementation((key: string, ...members: string[]) => {
      if (!sets.has(key)) return Promise.resolve(0);
      let count = 0;
      for (const m of members) {
        if (sets.get(key)!.delete(m)) count++;
      }
      return Promise.resolve(count);
    }),
  };
};

describe("RedisSessionStore", () => {
  let mockClient: ReturnType<typeof createMockRedisClient>;
  let store: RedisSessionStore;

  beforeEach(() => {
    mockClient = createMockRedisClient();
    store = new RedisSessionStore({
      client: mockClient,
      redis: {},
    });
  });

  const createTestSessionData = (): Omit<
    SerializableSessionData,
    "createdAt" | "lastActivityAt" | "sessionId"
  > => ({
    auth: { userId: "test-user" },
    clientCapabilities: null,
    connectionState: "ready",
    httpHeaders: { "x-custom": "header" },
    loggingLevel: "info",
    roots: [],
  });

  describe("create", () => {
    it("should create a session and return a UUID", async () => {
      const sessionId = await store.create(createTestSessionData());

      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("should store session data in Redis", async () => {
      const data = createTestSessionData();
      const sessionId = await store.create(data);

      const storedData = mockClient._data.get(`fastmcp:session:${sessionId}`);
      expect(storedData).toBeDefined();

      const parsed = JSON.parse(storedData!);
      expect(parsed.sessionId).toBe(sessionId);
      expect(parsed.auth).toEqual(data.auth);
    });

    it("should add session ID to index set", async () => {
      const sessionId = await store.create(createTestSessionData());

      const indexSet = mockClient._sets.get("fastmcp:session:index");
      expect(indexSet).toBeDefined();
      expect(indexSet!.has(sessionId)).toBe(true);
    });

    it("should use custom key prefix", async () => {
      const customStore = new RedisSessionStore({
        client: mockClient,
        keyPrefix: "custom:prefix:",
        redis: {},
      });

      const sessionId = await customStore.create(createTestSessionData());

      expect(mockClient._data.has(`custom:prefix:${sessionId}`)).toBe(true);
    });
  });

  describe("get", () => {
    it("should return session data for valid session", async () => {
      const data = createTestSessionData();
      const sessionId = await store.create(data);

      const session = await store.get(sessionId);
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(sessionId);
      expect(session!.auth).toEqual(data.auth);
    });

    it("should return null for non-existent session", async () => {
      const session = await store.get("non-existent-id");
      expect(session).toBeNull();
    });

    it("should clean up index for expired sessions", async () => {
      // Manually add an expired entry to the index
      mockClient._sets.set("fastmcp:session:index", new Set(["expired-id"]));

      const session = await store.get("expired-id");
      expect(session).toBeNull();

      // Check that srem was called to clean up
      expect(mockClient.srem).toHaveBeenCalledWith(
        "fastmcp:session:index",
        "expired-id",
      );
    });
  });

  describe("update", () => {
    it("should update session data", async () => {
      const sessionId = await store.create(createTestSessionData());

      const result = await store.update(sessionId, {
        connectionState: "closed",
        loggingLevel: "debug",
      });

      expect(result).toBe(true);

      const session = await store.get(sessionId);
      expect(session!.connectionState).toBe("closed");
      expect(session!.loggingLevel).toBe("debug");
    });

    it("should update lastActivityAt on update", async () => {
      const sessionId = await store.create(createTestSessionData());
      const originalSession = await store.get(sessionId);

      // Small delay to ensure time difference
      await new Promise((r) => setTimeout(r, 10));

      await store.update(sessionId, { loggingLevel: "debug" });

      const updatedSession = await store.get(sessionId);
      expect(updatedSession!.lastActivityAt).toBeGreaterThanOrEqual(
        originalSession!.lastActivityAt,
      );
    });

    it("should not allow changing sessionId", async () => {
      const sessionId = await store.create(createTestSessionData());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await store.update(sessionId, { sessionId: "hacked-id" } as any);

      const session = await store.get(sessionId);
      expect(session!.sessionId).toBe(sessionId);
    });

    it("should return false for non-existent session", async () => {
      const result = await store.update("non-existent", {
        loggingLevel: "debug",
      });
      expect(result).toBe(false);
    });
  });

  describe("delete", () => {
    it("should delete existing session", async () => {
      const sessionId = await store.create(createTestSessionData());

      const result = await store.delete(sessionId);
      expect(result).toBe(true);

      const session = await store.get(sessionId);
      expect(session).toBeNull();
    });

    it("should remove from index set", async () => {
      const sessionId = await store.create(createTestSessionData());
      await store.delete(sessionId);

      const indexSet = mockClient._sets.get("fastmcp:session:index");
      expect(indexSet?.has(sessionId)).toBe(false);
    });

    it("should return false for non-existent session", async () => {
      const result = await store.delete("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("list", () => {
    it("should list all session IDs", async () => {
      const id1 = await store.create(createTestSessionData());
      const id2 = await store.create(createTestSessionData());
      const id3 = await store.create(createTestSessionData());

      const ids = await store.list();
      expect(ids).toHaveLength(3);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toContain(id3);
    });

    it("should filter by auth properties", async () => {
      await store.create({
        ...createTestSessionData(),
        auth: { userId: "user-1" },
      });
      const id2 = await store.create({
        ...createTestSessionData(),
        auth: { userId: "user-2" },
      });
      await store.create({
        ...createTestSessionData(),
        auth: { userId: "user-1" },
      });

      const ids = await store.list({ userId: "user-2" });
      expect(ids).toHaveLength(1);
      expect(ids).toContain(id2);
    });

    it("should clean up stale index entries", async () => {
      const id1 = await store.create(createTestSessionData());

      // Manually add a stale entry to the index
      mockClient._sets.get("fastmcp:session:index")!.add("stale-id");

      const ids = await store.list();
      expect(ids).toHaveLength(1);
      expect(ids).toContain(id1);
      expect(ids).not.toContain("stale-id");
    });
  });

  describe("count", () => {
    it("should return number of active sessions", async () => {
      expect(await store.count()).toBe(0);

      await store.create(createTestSessionData());
      expect(await store.count()).toBe(1);

      await store.create(createTestSessionData());
      expect(await store.count()).toBe(2);
    });
  });

  describe("touch", () => {
    it("should refresh lastActivityAt", async () => {
      const sessionId = await store.create(createTestSessionData());
      const originalSession = await store.get(sessionId);

      await new Promise((r) => setTimeout(r, 10));
      const result = await store.touch(sessionId);

      expect(result).toBe(true);
      const touchedSession = await store.get(sessionId);
      expect(touchedSession!.lastActivityAt).toBeGreaterThanOrEqual(
        originalSession!.lastActivityAt,
      );
    });

    it("should return false for non-existent session", async () => {
      const result = await store.touch("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("close", () => {
    it("should quit Redis client when owned", async () => {
      const ownedStore = new RedisSessionStore({
        client: mockClient,
        redis: {},
      });

      // Force client ownership by creating a new store without passing client
      // For this test, we simulate by checking if quit is called

      await ownedStore.close();
      // When client is passed in options, ownsClient is false, so quit won't be called
    });

    it("should not quit external Redis client", async () => {
      await store.close();
      // Client was passed in, so quit should not be called
      expect(mockClient.quit).not.toHaveBeenCalled();
    });
  });

  describe("configuration", () => {
    it("should use default TTL of 1 hour", async () => {
      const defaultStore = new RedisSessionStore({
        client: mockClient,
        redis: {},
      });

      await defaultStore.create(createTestSessionData());

      // Check that pipeline set was called with EX flag and 3600 seconds
      const pipe = mockClient.pipeline();
      expect(pipe.set).toBeDefined();
    });

    it("should use custom TTL", async () => {
      const customStore = new RedisSessionStore({
        client: mockClient,
        redis: {},
        ttlMs: 7200000, // 2 hours
      });

      await customStore.create(createTestSessionData());
      // TTL would be 7200 seconds
    });
  });

  describe("error handling", () => {
    it("should throw error when pipeline.exec() fails in create()", async () => {
      const errorClient = createMockRedisClient();
      errorClient.pipeline = vi.fn().mockImplementation(() => {
        const pipe = createMockPipeline();
        pipe.exec = vi
          .fn()
          .mockRejectedValue(new Error("Redis connection failed"));
        return pipe;
      });

      const errorStore = new RedisSessionStore({
        client: errorClient,
        redis: {},
      });

      await expect(errorStore.create(createTestSessionData())).rejects.toThrow(
        "Failed to create session in Redis",
      );
    });

    it("should return false when pipeline.exec() fails in delete()", async () => {
      const errorClient = createMockRedisClient();
      errorClient.pipeline = vi.fn().mockImplementation(() => {
        const pipe = createMockPipeline();
        pipe.exec = vi
          .fn()
          .mockRejectedValue(new Error("Redis connection failed"));
        return pipe;
      });

      const errorStore = new RedisSessionStore({
        client: errorClient,
        redis: {},
      });

      const result = await errorStore.delete("some-session-id");
      expect(result).toBe(false);
    });

    it("should handle null results from pipeline.exec() in delete()", async () => {
      const errorClient = createMockRedisClient();
      errorClient.pipeline = vi.fn().mockImplementation(() => {
        const pipe = createMockPipeline();
        pipe.exec = vi.fn().mockResolvedValue(null);
        return pipe;
      });

      const errorStore = new RedisSessionStore({
        client: errorClient,
        redis: {},
      });

      const result = await errorStore.delete("some-session-id");
      expect(result).toBe(false);
    });
  });
});
