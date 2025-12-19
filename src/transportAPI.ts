import type { DetailedTripData, PreliminaryTripData } from "./types.js";

/**
 * A simple request queue to limit the rate of requests made to the transport API.
 */
class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private interval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(intervalMs: number) {
    this.interval = intervalMs;
  }

  setQueue(queue: (() => Promise<void>)[]) {
    this.queue = queue;
  }

  add(job: () => Promise<void>) {
    this.queue.push(job);
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      if (this.queue.length === 0) { return; }
      const job = this.queue.shift()!;
      await job();
    }, this.interval);
  }
}

const requestQueue = new RequestQueue(600); // 1 request every 600ms


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

/**
 * Appends a request to the queue to fetch trip details for the given id.
 * @param id Trip id
 * @param tripCallback Callback to be called with the fetched trip details
 */
export async function fetchTripDetails(id: string, tripCallback: (data: DetailedTripData) => void) {
  const url = `https://v6.bvg.transport.rest/trips/${id}?polyline=true`;
  requestQueue.add(async () => {
    const response = await fetch(url);
    const responseData = await response.json();
    // TODO handle 500 response
    tripCallback(responseData.trip);
  });
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
    const url = `https://v6.bvg.transport.rest/trips/${id}?polyline=true`;
    const response = await fetch(url);
    const responseData = await response.json();
    // TODO handle 500 response
    tripCallback(id, responseData.trip);
  }));
}
