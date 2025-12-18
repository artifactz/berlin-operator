import Bottleneck from "bottleneck";
import type { DetailedTripData, PreliminaryTripData } from "./types.js";

// Limiter: 100 requests per minute, 200 burst
const limiter = new Bottleneck({
  minTime: 20, // ms
  reservoir: 1, //200,
  reservoirRefreshInterval: 60 * 1000 / 100,
  reservoirRefreshAmount: 1,
});

async function limitedFetchAllTrips(url: string): Promise<Array<PreliminaryTripData>> {
  return limiter.schedule(() =>
    fetch(url)
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
  );
}

export async function fetchAllTrips(): Promise<Array<PreliminaryTripData>> {
  const urls = [...Array(7)].map((u, i) => 'https://v6.bvg.transport.rest/trips?operatorNames=Berliner Verkehrsbetriebe,S-Bahn Berlin GmbH'
      + '&suburban=' + (i === 0)
      + '&subway=' + (i === 1)
      + '&tram=' + (i === 2)
      + '&bus=' + (i === 3)
      + '&ferry=' + (i === 4)
      + '&express=' + (i === 5)
      + '&regional=' + (i === 6));

  const tripsLists = await Promise.all(urls.map(u => limitedFetchAllTrips(u)));

  return tripsLists.flat();
}

export async function fetchTripDetails(id: string): Promise<DetailedTripData> {
  const url = `https://v6.bvg.transport.rest/trips/${id}?polyline=true`;
  return limiter.schedule(() =>
    fetch(url)
      .then(async response => {
        const responseData = await response.json();
        // TODO handle 500 response
        return responseData.trip;
      })
  );
}
