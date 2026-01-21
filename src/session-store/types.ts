import type {
  ClientCapabilities,
  Root,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Serializable session data that can be stored externally.
 * This represents the state of a FastMCPSession that can be persisted
 * to external storage for horizontal scaling.
 */
export interface SerializableSessionData<T = Record<string, unknown>> {
  /** Authentication data from the authenticate callback */
  auth: T | undefined;
  /** Client capabilities negotiated during connection */
  clientCapabilities: ClientCapabilities | null;
  /** Current connection state */
  connectionState: "closed" | "connecting" | "error" | "ready";
  /** Timestamp when session was created */
  createdAt: number;
  /** HTTP headers from the initial connection */
  httpHeaders: Record<string, string> | undefined;
  /** Timestamp of last activity (used for TTL) */
  lastActivityAt: number;
  /** Current logging level */
  loggingLevel: string;
  /** Filesystem roots available to the client */
  roots: Root[];
  /** Unique session identifier */
  sessionId: string;
}

/**
 * Abstract interface for session storage backends.
 * Implementations can store sessions in memory, Redis, databases, etc.
 */
export interface SessionStore<T = Record<string, unknown>> {
  /**
   * Close the store and release any resources.
   * Called when the server is shutting down.
   */
  close(): Promise<void>;

  /**
   * Get count of active sessions.
   * @returns Number of active (non-expired) sessions
   */
  count(): Promise<number>;

  /**
   * Create a new session and return its ID.
   * @param data - Initial session data (sessionId, createdAt, lastActivityAt will be auto-generated)
   * @returns The generated session ID
   */
  create(
    data: Omit<
      SerializableSessionData<T>,
      "createdAt" | "lastActivityAt" | "sessionId"
    >,
  ): Promise<string>;

  /**
   * Delete a session.
   * @param sessionId - The session ID to delete
   * @returns true if session was found and deleted, false otherwise
   */
  delete(sessionId: string): Promise<boolean>;

  /**
   * Retrieve a session by ID.
   * @param sessionId - The session ID to look up
   * @returns The session data, or null if not found or expired
   */
  get(sessionId: string): Promise<null | SerializableSessionData<T>>;

  /**
   * List all active session IDs.
   * @param filter - Optional filter to match against auth properties
   * @returns Array of session IDs matching the filter
   */
  list(filter?: Partial<T>): Promise<string[]>;

  /**
   * Touch a session to refresh its TTL without modifying data.
   * @param sessionId - The session ID to touch
   * @returns true if session was found and touched, false otherwise
   */
  touch(sessionId: string): Promise<boolean>;

  /**
   * Update an existing session.
   * Automatically updates lastActivityAt timestamp.
   * @param sessionId - The session ID to update
   * @param data - Partial session data to merge
   * @returns true if session was found and updated, false otherwise
   */
  update(
    sessionId: string,
    data: Partial<SerializableSessionData<T>>,
  ): Promise<boolean>;
}

/**
 * Options for configuring session stores.
 */
export interface SessionStoreOptions {
  /**
   * Key prefix for storage backends that use key-value stores.
   * @default "fastmcp:session:"
   */
  keyPrefix?: string;

  /**
   * Time-to-live for sessions in milliseconds.
   * Sessions will be considered expired after this duration of inactivity.
   * @default 3600000 (1 hour)
   */
  ttlMs?: number;
}
