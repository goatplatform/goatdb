/**
 * Simple process lifecycle manager for browser testing infrastructure.
 * Handles spawning and cleanup of child processes with graceful shutdown.
 */

export class ProcessManager {
  private processes = new Set<Deno.ChildProcess>();

  /**
   * Spawn a new child process and track it for cleanup.
   */
  spawn(
    command: string,
    args: string[],
    options?: Deno.CommandOptions,
  ): Deno.ChildProcess {
    const process = new Deno.Command(command, { args, ...options }).spawn();
    this.processes.add(process);

    // Auto-cleanup when process exits naturally
    process.status.finally(() => this.processes.delete(process));
    return process;
  }

  /**
   * Clean up all tracked processes with graceful shutdown.
   * Sends SIGTERM, waits, then SIGKILL if needed.
   */
  async cleanup(gracefulTimeoutMs = 3000): Promise<void> {
    if (this.processes.size === 0) return;

    console.log(`Cleaning up ${this.processes.size} processes...`);

    // Phase 1: Send SIGTERM to all processes
    for (const process of this.processes) {
      try {
        process.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    }

    // Phase 2: Wait for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, gracefulTimeoutMs));

    // Phase 3: Force kill any remaining processes
    for (const process of this.processes) {
      try {
        process.kill('SIGKILL');
      } catch {
        // Process may already be dead
      }
    }

    this.processes.clear();
    console.log('Process cleanup completed');
  }
}
