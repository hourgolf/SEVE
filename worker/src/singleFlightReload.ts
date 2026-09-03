/**
 * Coalesces concurrent configuration reload requests into one attempt.
 *
 * The caller remains responsible for building the next configuration off to
 * the side and committing it only after every validation has passed. Joining
 * callers await the same attempt, so no decision loop can run through a second
 * partially-started reload while the first one is still in flight.
 */
export class SingleFlightReload {
  private inFlight: Promise<void> | null = null;

  run(attempt: () => Promise<void>): Promise<void> {
    if (this.inFlight) return this.inFlight;

    const flight = attempt();
    this.inFlight = flight;
    void flight.finally(() => {
      if (this.inFlight === flight) this.inFlight = null;
    }).catch(() => {
      // The original promise carries the failure to every joining caller.
      // This branch only consumes the promise returned by finally().
    });
    return flight;
  }

  get active(): boolean {
    return this.inFlight != null;
  }
}
