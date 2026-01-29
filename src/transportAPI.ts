import type { DetailedTripData, PreliminaryTripData } from "./types.js";

/**
 * A simple request queue to limit the rate of requests made to the transport API.
 */
class RequestQueue {
  private queue: (() => void)[] = [];
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
  setQueue(queue: (() => void)[]) {
    this.queue = queue.reverse();
    this.start();
  }

  /**
   * Adds a job to the request queue as the next job to be executed.
   */
  add(job: () => void) {
    this.queue.push(job);
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => { this.#work(); }, this.interval);
  }

  #work() {
    if (this.burstTimestamp !== null && (Date.now() - this.burstTimestamp) > this.burstDuration) {
      this.burstTimestamp = null;
      this.updateInterval(this.originalInterval);
    }

    if (this.backoffTimestamp !== null) {
      if (Date.now() - this.backoffTimestamp > this.backoffDuration) {
        this.backoffTimestamp = null;
        console.log('Resuming requests');
      } else {
        return; // Back off
      }
    }

    const job = this.queue.pop();
    if (job) { job(); }
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
export async function fetchAllTrips(
  tripCallback: (data: PreliminaryTripData) => void,
  finishedCallback: () => void,
) {
  const numRequests = 7;
  const urls = [...Array(numRequests)].map((u, i) => 'https://v6.bvg.transport.rest/trips?operatorNames=Berliner Verkehrsbetriebe,S-Bahn Berlin GmbH'
      + '&pretty=false'
      + '&suburban=' + (i === 0)
      + '&subway=' + (i === 1)
      + '&tram=' + (i === 2)
      + '&bus=' + (i === 3)
      + '&ferry=' + (i === 4)
      + '&express=' + (i === 5)
      + '&regional=' + (i === 6));

  let numFinishedRequests = 0;
  for (const url of urls) {
    // Fetch urls sequentially to enable wait-and-retry logic
    const trips = await fetchAllTripsFromUrl(url);
    trips.forEach(tripCallback);
    numFinishedRequests++;
    if (numFinishedRequests == numRequests) { finishedCallback(); }
  }
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
    })
    .catch(async error => {
      console.error(error);
      console.log('Retrying after 10 s...');
      // Retry after 10 s
      return new Promise((resolve) => setTimeout(resolve, 10000))
        .then(() => fetchAllTripsFromUrl(url));
    });
}

/**
 * Pushes a request to the queue to fetch trip details for the given id as the next job to be executed.
 * @param id Trip id
 * @param tripCallback Callback to be called with the fetched trip details
 */
export function fetchTripDetails(id: string, tripCallback: (data: DetailedTripData) => void) {
  requestQueue.add(() => performTripRequest(id, (id, data) => tripCallback(data)));
}

/**
 * Sets the request queue to fetch trip details for the given ids.
 * @param ids Array of trip ids to fetch details for
 * @param tripCallback Callback to be called for each fetched trip
 */
export function updateRequestQueue(
  ids: string[],
  tripCallback: (id: string, data: DetailedTripData) => void
) {
  requestQueue.setQueue(ids.map(id => () => performTripRequest(id, tripCallback)));
}

function performTripRequest(
  id: string,
  tripCallback: (id: string, data: DetailedTripData) => void
) {
    const url = `https://v6.bvg.transport.rest/trips/${id}?polyline=true`;

    const onFail = () => {
      // Wait and retry
      backoff();
      requestQueue.add(() => performTripRequest(id, tripCallback));
    }

    fetch(url)
      .then((response) => {
        if (response.status == 200) {
          response.json().then(responseData => tripCallback(id, responseData.trip));
          return;
        }

        if (response.status == 304) {
          tripCallback(id, { notModified: true });
          return;
        }

        console.warn(`Error fetching trip details for id ${id}: ${response.status} ${response.statusText}`);
        onFail();
      })
      .catch((error) => {
        console.error(`Error fetching trip details for id ${id}: ${error}`);
        onFail();
      });
}

export function burst(intervalMs = 300, durationMs = 60000) {
  requestQueue.burst(intervalMs, durationMs);
}

export function backoff(durationMs = 10000) {
  requestQueue.backoff(durationMs);
}
