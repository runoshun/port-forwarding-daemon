import { SSHForwardingServer } from "../../lib/forwarder/ssh.ts";
import { install_deno_cmd } from "../../lib/deno_install.ts";
import * as settings from "../../lib/settings.ts";

import * as log from "../../lib/logging.ts";
import { dirname } from "jsr:@std/path@0.223/dirname";

export class SSHAgentManager {
  private sshAgentProcess: Deno.ChildProcess | undefined = undefined;
  private readonly remoteHost: string;

  constructor(private sshForwardingManagerServer: SSHForwardingServer) {
    this.remoteHost = sshForwardingManagerServer.remoteHost;
  }

  async start() {
    log.info("Starting SSH agent manager: " + this.remoteHost);
    const mkdirCmd = new Deno.Command("ssh", {
      args: [
        this.remoteHost,
        "mkdir",
        "-p",
        dirname(settings.MAIN_SCRIPT_PATH),
      ],
    }).spawn();
    await mkdirCmd.status;

    const scpProcess = new Deno.Command("scp", {
      args: [
        settings.MAIN_SCRIPT_PATH,
        `${this.remoteHost}:${settings.MAIN_SCRIPT_PATH}`,
      ],
      stdout: "null",
    }).spawn();
    await scpProcess.status;

    const installCmd = new Deno.Command("ssh", {
      args: [
        this.remoteHost,
        "bash",
        "-c",
        `'${install_deno_cmd(settings.DENO_INSTALL_PATH)}'`,
      ],
    }).spawn();
    await installCmd.status;

    const managerServerPort = this.sshForwardingManagerServer.port;
    this.sshAgentProcess = new Deno.Command("ssh", {
      args: [
        "-tt",
        "-o",
        "ControlMaster=yes",
        "-o",
        `ControlPath=${this.sshForwardingManagerServer.sshControlPath}`,
        "-R",
        `${managerServerPort}:localhost:${managerServerPort}`,
        this.remoteHost,
        `${settings.DENO_INSTALL_PATH}/bin/deno -A ${settings.MAIN_SCRIPT_PATH} ${settings.COMMANDS.SSH} 'http://localhost:${managerServerPort}'`,
      ],
      stdin: "null",
    }).spawn();
    this.sshAgentProcess.unref();
  }

  async stop() {
    await this.sshForwardingManagerServer.stop();
    if (this.sshAgentProcess) {
      try {
        this.sshAgentProcess.kill("SIGTERM");
      } catch (_e) {
        // ignore
      }
    }
  }
}
