import type { DetailedTripData, PreliminaryTripData } from "./types.js";

/**
 * A simple request queue to limit the rate of requests made to the transport API.
 */
class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private interval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private burstTimestamp: number | null = null;
  private burstDuration = 0;
  private originalInterval = 0;
  private hasBurst = true;

  private backoffTimestamp: number | null = null;
  private backoffDuration = 0;

  constructor(intervalMs: number) {
    this.interval = intervalMs;
  }

  /**
   * Sets the request queue to the given array of jobs in the order to be executed.
   */
  setQueue(queue: (() => Promise<void>)[]) {
    this.queue = queue.reverse();
    this.start();
  }

  /**
   * Adds a job to the request queue as the next job to be executed.
   */
  add(job: () => Promise<void>) {
    this.queue.push(job);
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      if (this.burstTimestamp !== null && (Date.now() - this.burstTimestamp) > this.burstDuration) {
        this.burstTimestamp = null;
        this.updateInterval(this.originalInterval);
      }

      if (this.backoffTimestamp !== null) {
        if (Date.now() - this.backoffTimestamp > this.backoffDuration) {
          this.backoffTimestamp = null;
        } else {
          return; // Back off
        }
      }

      if (this.queue.length === 0) { return; }

      const job = this.queue.pop()!;
      await job();
    }, this.interval);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); }
    this.timer = null;
    this.running = false;
  }

  /**
   * Starts burst mode, i.e. temporarily increasing the request rate.
   * @param intervalMs New request interval
   * @param durationMs Burst mode duration in milliseconds
   */
  burst(intervalMs: number, durationMs: number) {
    if (!this.hasBurst) { return; }
    this.burstTimestamp = Date.now();
    this.burstDuration = durationMs;
    this.originalInterval = this.interval;
    this.hasBurst = false;
    this.updateInterval(intervalMs);
  }

  /**
   * Starts backoff mode, i.e. temporarily stopping requests.
   * @param durationMs Backoff duration in milliseconds
   */
  backoff(durationMs: number) {
    // Cancel burst if currently active
    if (this.burstTimestamp !== null) {
      this.burstTimestamp = null;
      this.updateInterval(this.originalInterval);
    }

    this.backoffDuration = durationMs;
    this.backoffTimestamp = Date.now();

    console.log(`Backing off requests for ${durationMs}ms`);
  }

  updateInterval(intervalMs: number) {
    this.stop();
    this.interval = intervalMs;
    this.start();
    console.log(`Request queue interval updated to ${intervalMs}ms`);
  }
}

const requestQueue = new RequestQueue(600); // 1 request every 600ms


/**
 * Fetches all trips from the transport API by making multiple requests for different transport types to avoid
 * a "TOO_MANY" error.
 * @param tripCallback Callback to be called for each fetched trip
 * @param finishedCallback Callback to be called when all trips have been fetched
 */
export function fetchAllTrips(
  tripCallback: (data: PreliminaryTripData) => void,
  finishedCallback: () => void,
) {
  const numRequests = 7;
  const urls = [...Array(numRequests)].map((u, i) => 'https://v6.bvg.transport.rest/trips?operatorNames=Berliner Verkehrsbetriebe,S-Bahn Berlin GmbH'
      + '&suburban=' + (i === 0)
      + '&subway=' + (i === 1)
      + '&tram=' + (i === 2)
      + '&bus=' + (i === 3)
      + '&ferry=' + (i === 4)
      + '&express=' + (i === 5)
      + '&regional=' + (i === 6));

  let numFinishedRequests = 0;
  urls.forEach(url => {
    fetchAllTripsFromUrl(url).then(trips => {
      trips.forEach(tripCallback);
      numFinishedRequests++;
      if (numFinishedRequests == numRequests) { finishedCallback(); }
    });
  });
}

async function fetchAllTripsFromUrl(url: string): Promise<Array<PreliminaryTripData>> {
  return fetch(url)
    .then(async response => {
      const responseData = await response.json();
      if (response.ok) {
        return responseData['trips'];
      }
      if (responseData['hafasCode'] == 'NO_MATCH') {
        return [];
      }
      throw new Error(`Error fetching ${url}: ${responseData['message'] || response.statusText}`);
    });
}

/**
 * Pushes a request to the queue to fetch trip details for the given id as the next job to be executed.
 * @param id Trip id
 * @param tripCallback Callback to be called with the fetched trip details
 */
export async function fetchTripDetails(id: string, tripCallback: (data: DetailedTripData) => void) {
  requestQueue.add(async () => await performTripRequest(id, (id, data) => tripCallback(data)));
}

/**
 * Sets the request queue to fetch trip details for the given ids.
 * @param ids Array of trip ids to fetch details for
 * @param tripCallback Callback to be called for each fetched trip
 */
export async function updateRequestQueue(
  ids: string[],
  tripCallback: (id: string, data: DetailedTripData) => void
) {
  requestQueue.setQueue(ids.map(id => async () => {
    await performTripRequest(id, tripCallback);
  }));
}

async function performTripRequest(
  id: string,
  tripCallback: (id: string, data: DetailedTripData) => void
) {
    const url = `https://v6.bvg.transport.rest/trips/${id}?polyline=true`;
    const response = await fetch(url);

    if (response.status == 500) {
      backoff();
      requestQueue.add(() => performTripRequest(id, tripCallback));
    }

    if (response.status == 304) {
      tripCallback(id, { notModified: true });
      return;
    }

    const responseData = await response.json();
    tripCallback(id, responseData.trip);
}

export function burst(intervalMs = 300, durationMs = 60000) {
  requestQueue.burst(intervalMs, durationMs);
}

export function backoff(durationMs = 10000) {
  requestQueue.backoff(durationMs);
}
