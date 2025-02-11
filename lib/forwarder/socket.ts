/**
 * Simple socat-like functionality for TCP and Unix domain sockets
 */
import * as log from "../logging.ts";

export interface SocketForwardingOptions {
  sourceType: "tcp" | "unix";
  sourceAddress: string;
  sourcePort?: number;
  targetType: "tcp" | "unix";
  targetAddress: string;
  targetPort?: number;
}

export class SocketForwarder {
  private server: Deno.Listener | null = null;
  private connections: Set<Promise<void>> = new Set();

  constructor(private options: SocketForwardingOptions) {}

  forwardingInfo() {
    return `${this.options.sourceType}://${this.options.sourceAddress}:${this.options.sourcePort} -> ${this.options.targetType}://${this.options.targetAddress}:${this.options.targetPort} on ${Deno.hostname()}`;
  }

  /**
   * Start forwarding
   */
  start() {
    if (this.server) return;
    log.debug("[Forwarder] Starting " + this.forwardingInfo());

    // Cleanup existing Unix socket file if needed
    if (this.options.sourceType === "unix") {
      try {
        Deno.removeSync(this.options.sourceAddress);
      } catch {
        // Ignore errors if file doesn't exist
      }
    }

    // Create source listener
    if (this.options.sourceType === "tcp") {
      this.server = Deno.listen({
        hostname: this.options.sourceAddress,
        port: this.options.sourcePort!,
      });
    } else {
      this.server = Deno.listen({
        path: this.options.sourceAddress,
        transport: "unix",
      });
    }

    // Accept connections
    this.acceptConnections();
    log.debug("[Forwarder] Started " + this.forwardingInfo());
  }

  /**
   * Stop forwarding
   */
  async stop() {
    if (!this.server) return;

    this.server.close();
    this.server = null;

    // Wait for all connections to close
    await Promise.all(Array.from(this.connections));

    // Cleanup Unix socket file
    if (this.options.sourceType === "unix") {
      try {
        await Deno.remove(this.options.sourceAddress);
      } catch {
        // Ignore cleanup errors
      }
    }
    log.debug("[Forwarder] Stopped " + this.forwardingInfo());
  }

  private async acceptConnections() {
    if (!this.server) return;

    try {
      for await (const conn of this.server) {
        this.handleConnection(conn);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.BadResource)) {
        log.error("Accept error:", error);
      }
    }
  }

  private async handleConnection(sourceConn: Deno.Conn) {
    log.debug(
      `[Forwarder]New connection from ${
        (sourceConn.remoteAddr as Deno.NetAddr).hostname
      }:${(sourceConn.remoteAddr as Deno.NetAddr).port} ` +
        this.forwardingInfo(),
    );
    let targetConn: Deno.Conn;

    try {
      // Connect to target
      if (this.options.targetType === "tcp") {
        const hostname = this.options.targetAddress === "localhost"
          ? "127.0.0.1"
          : this.options.targetAddress;
        targetConn = await Deno.connect({
          hostname: hostname,
          port: this.options.targetPort!,
        });
      } else {
        targetConn = await Deno.connect({
          path: this.options.targetAddress,
          transport: "unix",
        });
      }
    } catch (error) {
      log.error("Failed to connect to target:", error);
      sourceConn.close();
      return;
    }

    // Create bidirectional pipe
    const pipe = this.createBidirectionalPipe(sourceConn, targetConn);
    this.connections.add(pipe);
    pipe.then(() => this.connections.delete(pipe));
  }

  private async createBidirectionalPipe(
    conn1: Deno.Conn,
    conn2: Deno.Conn,
  ): Promise<void> {
    const pipe1 = this.pipe(conn1, conn2).catch((error) =>
      log.error("Pipe 1->2 error:", error)
    );
    const pipe2 = this.pipe(conn2, conn1).catch((error) =>
      log.error("Pipe 2->1 error:", error)
    );

    try {
      await Promise.all([pipe1, pipe2]);
    } finally {
      conn1.close();
      conn2.close();
    }
  }

  private async pipe(source: Deno.Conn, target: Deno.Conn) {
    const buffer = new Uint8Array(16384);
    try {
      while (true) {
        const n = await source.read(buffer);
        if (n === null) break;
        await target.write(buffer.subarray(0, n));
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.BadResource)) {
        throw error;
      }
    }
  }
}
