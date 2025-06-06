interface TcpEntry {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: number;
  uid: number;
}

export class PortDetector {
  private currentPorts: Set<number> = new Set();
  private intervalId: number | undefined;

  constructor(
    private readonly onPortOpen: (port: number) => void,
    private readonly onPortClose: (port: number) => void,
    private readonly maxPort: number = 65535,
    private readonly uid: number = Deno.uid() ?? 0,
    private readonly interval: number = 1000,
  ) {}

  /**
   * Parse a line from /proc/net/tcp
   */
  public parseTcpLine(line: string): TcpEntry | null {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 12) return null;

    // Skip header line
    if (parts[0] === "sl") return null;

    const [localIp, localPort] = parts[1].split(":");
    const [remoteIp, remotePort] = parts[2].split(":");

    return {
      localAddress: localIp,
      localPort: parseInt(localPort, 16),
      remoteAddress: remoteIp,
      remotePort: parseInt(remotePort, 16),
      state: parseInt(parts[3], 16),
      uid: parseInt(parts[7]),
    };
  }

  /**
   * Read and parse /proc/net/tcp
   */
  private async readTcpTable(): Promise<TcpEntry[]> {
    const content = await Deno.readTextFile("/proc/net/tcp");
    return content
      .split("\n")
      .map((line) => this.parseTcpLine(line))
      .filter((entry): entry is TcpEntry => entry !== null);
  }

  /**
   * Check for new listening ports
   */
  private async checkPorts(initial: boolean = false) {
    const entries = await this.readTcpTable();

    // TCP_LISTEN state is 0x0A
    const listeningPorts = new Set(
      entries
        .filter((entry) => entry.state === 0x0a && entry.uid === this.uid)
        .map((entry) => entry.localPort),
    );

    // Find new ports
    for (const port of listeningPorts) {
      if (!this.currentPorts.has(port) && !initial && port <= this.maxPort) {
        this.onPortOpen(port);
      }
    }
    // Find removed ports
    for (const port of this.currentPorts) {
      if (!listeningPorts.has(port) && !initial && port <= this.maxPort) {
        this.onPortClose(port);
      }
    }

    this.currentPorts = listeningPorts;
  }

  /**
   * Start watching for new listening ports
   */
  start() {
    if (this.intervalId) return;

    // Do initial check
    this.checkPorts(true);

    // Start periodic checks
    this.intervalId = setInterval(() => {
      this.checkPorts();
    }, this.interval);
  }

  /**
   * Stop watching
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}

/*
This document describes the interfaces /proc/net/tcp and /proc/net/tcp6.
Note that these interfaces are deprecated in favor of tcp_diag.

These /proc interfaces provide information about currently active TCP
connections, and are implemented by tcp4_seq_show() in net/ipv4/tcp_ipv4.c
and tcp6_seq_show() in net/ipv6/tcp_ipv6.c, respectively.

It will first list all listening TCP sockets, and next list all established
TCP connections. A typical entry of /proc/net/tcp would look like this (split
up into 3 parts because of the length of the line):

   46: 010310AC:9C4C 030310AC:1770 01
   |      |      |      |      |   |--> connection state
   |      |      |      |      |------> remote TCP port number
   |      |      |      |-------------> remote IPv4 address
   |      |      |--------------------> local TCP port number
   |      |---------------------------> local IPv4 address
   |----------------------------------> number of entry

   00000150:00000000 01:00000019 00000000
      |        |     |     |       |--> number of unrecovered RTO timeouts
      |        |     |     |----------> number of jiffies until timer expires
      |        |     |----------------> timer_active (see below)
      |        |----------------------> receive-queue
      |-------------------------------> transmit-queue

   1000        0 54165785 4 cd1e6040 25 4 27 3 -1
    |          |    |     |    |     |  | |  | |--> slow start size threshold,
    |          |    |     |    |     |  | |  |      or -1 if the threshold
    |          |    |     |    |     |  | |  |      is >= 0xFFFF
    |          |    |     |    |     |  | |  |----> sending congestion window
    |          |    |     |    |     |  | |-------> (ack.quick<<1)|ack.pingpong
    |          |    |     |    |     |  |---------> Predicted tick of soft clock
    |          |    |     |    |     |              (delayed ACK control data)
    |          |    |     |    |     |------------> retransmit timeout
    |          |    |     |    |------------------> location of socket in memory
    |          |    |     |-----------------------> socket reference count
    |          |    |-----------------------------> inode
    |          |----------------------------------> unanswered 0-window probes
    |---------------------------------------------> uid

timer_active:
  0  no timer is pending
  1  retransmit-timer is pending
  2  another timer (e.g. delayed ack or keepalive) is pending
  3  this is a socket in TIME_WAIT state. Not all fields will contain
     data (or even exist)
  4  zero window probe timer is pending
*/
