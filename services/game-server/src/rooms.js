import { randomUUID } from 'node:crypto';

/**
 * @typedef {object} RoomConnection
 * @property {string} connectionId
 * @property {import('ws').WebSocket} socket
 * @property {string} userId
 * @property {number} lastSeenAt
 * @property {number} msgWindowStart
 * @property {number} msgCount
 */

/**
 * @typedef {object} ProbeRoom
 * @property {string} roomId
 * @property {Map<string, RoomConnection>} connections
 * @property {number} createdAt
 */

export class RoomRegistry {
  constructor({ maxPerRoom = 2 } = {}) {
    /** @type {Map<string, ProbeRoom>} */
    this.rooms = new Map();
    this.maxPerRoom = maxPerRoom;
  }

  /**
   * @param {string} roomId
   * @param {import('ws').WebSocket} socket
   * @param {string} userId
   */
  join(roomId, socket, userId) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { roomId, connections: new Map(), createdAt: Date.now() };
      this.rooms.set(roomId, room);
    }
    if (room.connections.size >= this.maxPerRoom) {
      const err = new Error('Room is full');
      err.code = 'ROOM_FULL';
      throw err;
    }
    const connectionId = randomUUID();
    const conn = {
      connectionId,
      socket,
      userId,
      lastSeenAt: Date.now(),
      msgWindowStart: Date.now(),
      msgCount: 0,
    };
    room.connections.set(connectionId, conn);
    return { room, conn, peers: room.connections.size };
  }

  /** @param {string} roomId @param {string} connectionId */
  leave(roomId, connectionId) {
    const room = this.rooms.get(roomId);
    if (!room) return { removed: false, empty: true, remaining: 0 };
    room.connections.delete(connectionId);
    const remaining = room.connections.size;
    if (remaining === 0) {
      this.rooms.delete(roomId);
      return { removed: true, empty: true, remaining: 0 };
    }
    return { removed: true, empty: false, remaining };
  }

  /** @param {string} roomId */
  get(roomId) {
    return this.rooms.get(roomId) ?? null;
  }

  roomCount() {
    return this.rooms.size;
  }

  connectionCount() {
    let n = 0;
    for (const room of this.rooms.values()) n += room.connections.size;
    return n;
  }

  /** @param {(conn: RoomConnection, room: ProbeRoom) => void} fn */
  forEachConnection(fn) {
    for (const room of this.rooms.values()) {
      for (const conn of room.connections.values()) fn(conn, room);
    }
  }

  clear() {
    this.rooms.clear();
  }
}

/**
 * @param {RoomConnection} conn
 * @param {number} maxPerSecond
 */
export function checkRateLimit(conn, maxPerSecond) {
  const now = Date.now();
  if (now - conn.msgWindowStart >= 1000) {
    conn.msgWindowStart = now;
    conn.msgCount = 0;
  }
  conn.msgCount += 1;
  return conn.msgCount <= maxPerSecond;
}
