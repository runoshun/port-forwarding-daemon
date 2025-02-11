import * as log from "../logging.ts";

interface SSHForwardingRequest {
  localPort: number;
  remoteHost?: string;
  remotePort: number;
  tag?: string;
}

class SSHForwarder {
  private processes: Map<string, { tag?: string }> = new Map();

  constructor(
    private remoteHost: string,
    private controlPath: string,
  ) {}

  private runSSH(args: string[]) {
    const sshArgs = [
      "-o",
      `ControlPath=${this.controlPath}`,
      ...args,
      this.remoteHost,
    ];
    log.debug(`Running SSH: ssh ${sshArgs.join(" ")}`);
    const cmd = new Deno.Command("ssh", { args: sshArgs }).spawn();
    return cmd.status;
  }

  async startForwarding(request: SSHForwardingRequest) {
    const remoteHost = request.remoteHost ?? "localhost";
    const key = `${request.localPort}:${remoteHost}:${request.remotePort}`;
    log.debug(`Starting SSH forwarding: ${key}`);

    // すでに同じ転送が存在する場合は何もしない
    if (this.processes.has(key)) {
      return;
    }
    const status = await this.runSSH(["-O", "forward", "-L", key]);
    if (!status.success) {
      log.error(`Failed to start SSH forwarding: ${key}`);
      return;
    }

    this.processes.set(key, { tag: request.tag });
    log.debug(`Current forwardings: ${Array.from(this.processes.keys())}`);
  }

  async stopForwarding(pat: RegExp) {
    for (const [key, _] of this.processes) {
      if (key.match(pat)) {
        log.info(`Stopping SSH forwarding: ${key}`);
        const status = await this.runSSH(["-O", "cancel", "-L", key]);
        if (!status.success) {
          log.error(`Failed to stop SSH forwarding: ${key}`);
        } else {
          this.processes.delete(key);
        }
      }
    }
    log.debug(`Current forwardings: ${Array.from(this.processes.keys())}`);
  }

  async stopForwardingByTag(tag: string) {
    for (const [key, { tag: t }] of this.processes) {
      if (t === tag) {
        await this.stopForwarding(new RegExp(key));
      }
    }
  }
}

export class SSHForwardingServer {
  private manager: SSHForwarder;
  public readonly remoteHost: string;

  public readonly port: number;
  public readonly sshControlPath: string;
  private server?: Deno.HttpServer;

  constructor({
    remoteHost,
    controlPath,
    serverPort,
  }: {
    remoteHost: string;
    controlPath: string;
    serverPort: number;
  }) {
    this.sshControlPath = controlPath;
    this.remoteHost = remoteHost;
    this.manager = new SSHForwarder(remoteHost, controlPath);
    this.port = serverPort;
  }

  start() {
    this.server = Deno.serve({ port: this.port }, async (request) => {
      if (request.method === "GET") {
        const forwardings = Array.from(this.manager["processes"].keys());
        const html = `
        <!DOCTYPE html>
        <body>
        <h1>SSH Forwardings</h1>
        <ul>
          ${
          forwardings
            .map(
              (f) =>
                `<li>${f}: <a href="http://localhost:${
                  f.split(":")[0]
                }">OPEN</a></li>`,
            )
            .join("")
        }
        </ul>
        </body>
        `;
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        });
      } else if (request.method === "POST") {
        try {
          const body: SSHForwardingRequest = await request.json();
          this.manager.startForwarding(body);
          return new Response("Forwarding started", { status: 200 });
        } catch (error) {
          log.error("Error processing request:", error);
          return new Response("Invalid request", { status: 400 });
        }
      } else if (request.method === "DELETE") {
        const url = new URL(request.url);
        const remotePort = url.searchParams.get("remotePort");
        const remoteHost = url.searchParams.get("remoteHost");
        const tag = url.searchParams.get("tag");

        if (remotePort && remoteHost) {
          await this.manager.stopForwarding(
            new RegExp(`:${remoteHost}:${remotePort}$`),
          );
          return new Response("Forwarding stopped", { status: 200 });
        } else if (remotePort) {
          await this.manager.stopForwarding(
            new RegExp(`localhost:${remotePort}$`),
          );
          return new Response("Forwarding stopped", { status: 200 });
        } else if (remoteHost) {
          await this.manager.stopForwarding(new RegExp(`:${remoteHost}:`));
          return new Response("Forwarding stopped", { status: 200 });
        }

        if (tag) {
          await this.manager.stopForwardingByTag(tag);
          return new Response("Forwarding stopped", { status: 200 });
        }
        return new Response("Invalid request", { status: 400 });
      }

      return new Response("Method not allowed", { status: 405 });
    });
  }

  async stop() {
    await this.server?.shutdown();
  }
}

export async function addSshForwarding(
  serverUrl: string,
  request: SSHForwardingRequest,
) {
  try {
    await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    log.error("Failed to send forwarding request:", error);
  }
}

export async function deleteSshForwarding(
  serverUrl: string,
  target: {
    remotePort?: number;
    remoteHost?: string;
    tag?: string;
  },
) {
  try {
    log.debug(`Deleting forwarding: ${JSON.stringify(target)}`);
    const { remotePort, remoteHost } = target;
    const query = new URLSearchParams();
    if (remotePort) {
      query.set("remotePort", remotePort.toString());
    }
    if (remoteHost) {
      query.set("remoteHost", remoteHost);
    }
    if (target.tag) {
      query.set("tag", target.tag);
    }
    await fetch(`${serverUrl}?${query.toString()}`, {
      method: "DELETE",
    });
  } catch (error) {
    log.error("Failed to send stop forwarding request:", error);
  }
}
