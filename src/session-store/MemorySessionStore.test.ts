import { setTimeout as delay } from "timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import type { SerializableSessionData } from "./types.js";

import { MemorySessionStore } from "./MemorySessionStore.js";

describe("MemorySessionStore", () => {
  let store: MemorySessionStore;

  afterEach(async () => {
    if (store) {
      await store.close();
    }
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
      store = new MemorySessionStore();
      const sessionId = await store.create(createTestSessionData());

      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("should set createdAt and lastActivityAt timestamps", async () => {
      store = new MemorySessionStore();
      const before = Date.now();
      const sessionId = await store.create(createTestSessionData());
      const after = Date.now();

      const session = await store.get(sessionId);
      expect(session).not.toBeNull();
      expect(session!.createdAt).toBeGreaterThanOrEqual(before);
      expect(session!.createdAt).toBeLessThanOrEqual(after);
      expect(session!.lastActivityAt).toBe(session!.createdAt);
    });
  });

  describe("get", () => {
    it("should return session data for valid session", async () => {
      store = new MemorySessionStore();
      const data = createTestSessionData();
      const sessionId = await store.create(data);

      const session = await store.get(sessionId);
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(sessionId);
      expect(session!.auth).toEqual(data.auth);
      expect(session!.httpHeaders).toEqual(data.httpHeaders);
      expect(session!.connectionState).toBe(data.connectionState);
    });

    it("should return null for non-existent session", async () => {
      store = new MemorySessionStore();
      const session = await store.get("non-existent-id");
      expect(session).toBeNull();
    });

    it("should return null for expired session", async () => {
      store = new MemorySessionStore({ ttlMs: 50 });
      const sessionId = await store.create(createTestSessionData());

      // Wait for session to expire
      await delay(100);

      const session = await store.get(sessionId);
      expect(session).toBeNull();
    });
  });

  describe("update", () => {
    it("should update session data", async () => {
      store = new MemorySessionStore();
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
      store = new MemorySessionStore();
      const sessionId = await store.create(createTestSessionData());
      const originalSession = await store.get(sessionId);

      await delay(10);
      await store.update(sessionId, { loggingLevel: "debug" });

      const updatedSession = await store.get(sessionId);
      expect(updatedSession!.lastActivityAt).toBeGreaterThan(
        originalSession!.lastActivityAt,
      );
    });

    it("should not allow changing sessionId", async () => {
      store = new MemorySessionStore();
      const sessionId = await store.create(createTestSessionData());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await store.update(sessionId, { sessionId: "hacked-id" } as any);

      const session = await store.get(sessionId);
      expect(session!.sessionId).toBe(sessionId);
    });

    it("should return false for non-existent session", async () => {
      store = new MemorySessionStore();
      const result = await store.update("non-existent", {
        loggingLevel: "debug",
      });
      expect(result).toBe(false);
    });
  });

  describe("delete", () => {
    it("should delete existing session", async () => {
      store = new MemorySessionStore();
      const sessionId = await store.create(createTestSessionData());

      const result = await store.delete(sessionId);
      expect(result).toBe(true);

      const session = await store.get(sessionId);
      expect(session).toBeNull();
    });

    it("should return false for non-existent session", async () => {
      store = new MemorySessionStore();
      const result = await store.delete("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("list", () => {
    it("should list all session IDs", async () => {
      store = new MemorySessionStore();
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
      store = new MemorySessionStore();
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

    it("should not include expired sessions", async () => {
      store = new MemorySessionStore({ ttlMs: 50 });
      const id1 = await store.create(createTestSessionData());

      await delay(100);

      const id2 = await store.create(createTestSessionData());

      const ids = await store.list();
      expect(ids).toHaveLength(1);
      expect(ids).toContain(id2);
      expect(ids).not.toContain(id1);
    });
  });

  describe("count", () => {
    it("should return number of active sessions", async () => {
      store = new MemorySessionStore();
      expect(await store.count()).toBe(0);

      await store.create(createTestSessionData());
      expect(await store.count()).toBe(1);

      await store.create(createTestSessionData());
      expect(await store.count()).toBe(2);
    });
  });

  describe("touch", () => {
    it("should refresh lastActivityAt", async () => {
      store = new MemorySessionStore();
      const sessionId = await store.create(createTestSessionData());
      const originalSession = await store.get(sessionId);

      await delay(20);
      const result = await store.touch(sessionId);

      expect(result).toBe(true);
      const touchedSession = await store.get(sessionId);
      expect(touchedSession!.lastActivityAt).toBeGreaterThanOrEqual(
        originalSession!.lastActivityAt,
      );
    });

    it("should return false for non-existent session", async () => {
      store = new MemorySessionStore();
      const result = await store.touch("non-existent");
      expect(result).toBe(false);
    });

    it("should return false for expired session", async () => {
      store = new MemorySessionStore({ ttlMs: 50 });
      const sessionId = await store.create(createTestSessionData());

      await delay(100);

      const result = await store.touch(sessionId);
      expect(result).toBe(false);
    });
  });

  describe("close", () => {
    it("should clear all sessions", async () => {
      store = new MemorySessionStore();
      await store.create(createTestSessionData());
      await store.create(createTestSessionData());

      await store.close();

      expect(await store.count()).toBe(0);
    });
  });

  describe("TTL and cleanup", () => {
    it("should use custom TTL", async () => {
      store = new MemorySessionStore({ ttlMs: 100 });
      const sessionId = await store.create(createTestSessionData());

      // Session should exist before TTL
      expect(await store.get(sessionId)).not.toBeNull();

      // Wait for TTL to expire
      await delay(150);

      // Session should be expired
      expect(await store.get(sessionId)).toBeNull();
    });
  });
});
