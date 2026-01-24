import { Trip } from "./trip.js"
import { burst, fetchAllTrips, fetchTripDetails, updateRequestQueue } from "./transportAPI.js";
import type { DetailedTripData, PreliminaryTripData } from "./types.js"

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';


/**
 * A trip on the map. Provides UI methods to a corresponding `Trip` object.
 */
class MapTrip {
  marker: L.Marker;
  trip: Trip

  constructor(trip: Trip) {
    this.trip = trip;

    const popupHtml = `<div class="line-info-container">
  <div class="line-name" style="background-color: ${trip.color}">${trip.name}</div>
  <div class="line-grid">
    <div class="line-grid-header">Von:</div>
    <div class="line-grid-data">${trip.origin}</div>
    <div class="line-grid-header">Nach:</div>
    <div class="line-grid-data">${trip.destination}</div>
  </div>
  <div id="trip-share-link" class="trip-share">
    <span class="material-symbols-outlined">share</span>
    Link
  </div>
</div>`;

    this.marker = L.marker([trip.data.currentLocation.latitude, trip.data.currentLocation.longitude], { // TODO property?
      icon: this.createIcon()
    })
      .bindPopup(popupHtml)
      .addTo(map)
      .on('popupopen', (e: L.PopupEvent) => {
        console.log(`Last update: ${(Date.now() - (trip.detailsTimestamp ?? trip.creationTimestamp)) / 1000} s ago.`);

        if (currentRoute) { currentRoute.forEach(layer => layer.remove()); }
        if (this.trip.isDetailed) { currentRoute = this.showRoute(); }

        const popupEl = e.popup.getElement() as HTMLElement | null;
        if (!popupEl) { return; }
        const btn = popupEl.querySelector('#trip-share-link') as HTMLElement | null;
        if (!btn) { return; }
        const handler = (ev: Event) => {
          ev.preventDefault();
          shareTrip(this.trip.id);
        };
        btn.addEventListener('click', handler);
        this.marker.once('popupclose', () => btn.removeEventListener('click', handler));
      })
      .on('popupclose', (e: L.PopupEvent) => {
        if (currentRoute) { currentRoute.forEach(layer => layer.remove()); }
        currentRoute = null;
      });
  }

  /**
   * Displays the full route of this trip on the map.
   * @returns Array of created Leaflet layers (polyline and stop markers).
   */
  showRoute(): Array<L.Layer> {
    const color = this.trip.color;
    const polylineLatLons = this.trip.getRouteLatLons();
    const polyline = L.polyline(polylineLatLons, {color}).addTo(map);
    const stopLatLons = this.trip.getStopLatLons();
    const stops = stopLatLons.map(([lat, lon]) => L.circleMarker([lat, lon], {
      radius: 5,
      color,
      weight: 2,
      fillColor: '#fff',
      fillOpacity: 1,
    }).addTo(map));

    return [...stops, polyline];
  }

  updateMarkerIcon(highlightUpdate = false) {
    this.marker.setIcon(this.createIcon(highlightUpdate));
  }

  createIcon(highlightUpdate = false): L.DivIcon {
    const className = (!this.trip.isDetailed)
      ? 'preliminary-vehicle vehicle'
      : highlightUpdate
        ? 'updated-vehicle vehicle'
        : 'vehicle';
    return L.divIcon({
      className,
      html: `<div>${this.trip.emoji}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  updateMarkerPosition() {
    const latLon = this.trip.getCurrentLatLon();
    this.marker.setLatLng([latLon.lat, latLon.lon]);
  }

  updatePreliminaryData(data: PreliminaryTripData) {
    this.trip.setPreliminaryData(data);
    this.updateMarkerPosition();
  }
}

export function shareTrip(id: string) {
  console.log(`Sharing trip with id ${id}.`);
  const urlId = id.replaceAll('|', '-'); // "prettier" than using encodeURI
  const url = `${window.location.origin}${window.location.pathname}?trip=${urlId}`;
  navigator.share({
    title: 'Live Transit Trip',
    text: 'Berlin Operator',
    url,
  });
}


const map = L.map('map').setView([52.52, 13.405], 13);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const locateButton = document.getElementById('locate-btn') as HTMLButtonElement;
locateButton.addEventListener('click', () => {
  map.locate({setView: true, maxZoom: 15});
});

const urlParams = new URLSearchParams(window.location.search);
const selectTripId = urlParams.get('trip')?.replaceAll('-', '|');
if (!selectTripId) { map.locate({setView: true, maxZoom: 15}); }  // TODO don't setView when out of town

let trips = new Map<string, MapTrip>();
let currentRoute: Array<L.Layer> | null = null;

map
  .on('click', (e) => {
    if (currentRoute) { currentRoute.forEach(layer => layer.remove()); }
    currentRoute = null;
  })
  .on('moveend zoomend', () => {
    updateRequestOrder();
    burst();
  });


/**
 * Fetches preliminary data for all trips, adds new ones, and schedules a detailed data request for them.
 */
function fetchNewTrips() {
  console.log('Fetching new trips...');
  fetchAllTrips((preliminaryData) => {
    if (trips.has(preliminaryData.id)) {
      trips.get(preliminaryData.id)!.updatePreliminaryData(preliminaryData);
      return;
    }
    const trip = new MapTrip(new Trip(preliminaryData));
    trips.set(preliminaryData.id, trip);

    if (selectTripId && trip.trip.id == selectTripId) {
      map.setView(trip.marker.getLatLng(), 15);
    }

    fetchTripDetails(preliminaryData.id, (detailedData) => {
      onDetailedData(trip, detailedData);
    });
  }, () => {
    updateRequestOrder();
    setTimeout(() => { fetchNewTrips(); }, 90000); // Fetch new trips every 90 seconds
  });
}

fetchNewTrips();


let updateRequestOrderTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Updates the request queue to fetch detailed trip data in order of proximity to the map center and time since last
 * update.
 * @param minRefreshIntervalSeconds Minimum interval between detailed data requests for the same trip.
 * @param preliminaryTripAge Age assigned to preliminary trips when calculating priority. This helps to avoid
 * preliminary trips along the map border taking priority over detailed trips in view eventually.
 * @param viewRadiusMeters Radius around the map center within which preliminary trips are prioritized.
 */
function updateRequestOrder(
  minRefreshIntervalSeconds: number = 30,
  preliminaryTripAge: number = 150,
  viewRadiusMeters: number = 4000
) {
  const queue = [];
  const center = map.getCenter();

  for (const trip of trips.values()) {
    const distanceMeters = map.distance(center, trip.marker.getLatLng());
    let ageSeconds;
    let firstUpdatePrio = 0;
    if (trip.trip.isDetailed) {
      ageSeconds = (Date.now() - trip.trip.detailsTimestamp!) / 1000;
      if (ageSeconds < minRefreshIntervalSeconds) { continue; } // Skip trips that were updated recently
    } else {
      ageSeconds = preliminaryTripAge;
      if (distanceMeters < viewRadiusMeters) { firstUpdatePrio = 1e6; } // Prioritize preliminary trips in view
    }
    const prioAge = 1 + ageSeconds; // High age -> high priority
    const prioDist = Math.exp(-distanceMeters / 5000); // High distance -> low priority
    const priority = firstUpdatePrio + prioDist * prioAge;

    queue.push({trip, priority});
  }

  queue.sort((a, b) => b.priority - a.priority);  // Descending

  updateRequestQueue(queue.map(item => item.trip.trip.id), (id, detailedData) => {
    const trip = trips.get(id);
    if (!trip) {
      // Trip probably just ended
      console.warn(`Discarding detailed data for outdated trip id ${id}.`);
      return;
    }
    onDetailedData(trip, detailedData);
  });

  if (updateRequestOrderTimer) { clearInterval(updateRequestOrderTimer); }
  updateRequestOrderTimer = setInterval(() => {
    updateRequestOrder();
  }, 10000);  // Update every 10 seconds
}

/**
 * Handles arrival of fetched detailed trip data.
 */
function onDetailedData(trip: MapTrip, data: DetailedTripData) {
  if (data.notModified) {
    trip.trip.detailsTimestamp = Date.now();
    highlightMarker(trip);
    return;
  }

  if (data.cancelled) {
    trip.marker.remove();
    trips.delete(trip.trip.id);
    return;  // Abort
  }

  if (data.id != trip.trip.id) {
    trips.delete(trip.trip.id);
    if (trips.has(data.id)) {
      console.log(`Removed trip with id ${trip.trip.id} becaused it resolved to existing trip with id ${data.id}.`);
      return;  // Abort
    } else {
      trips.set(data.id, trip);
      console.log(`Updated trip id from ${trip.trip.id} to ${data.id}.`);
    }
  }

  trip.trip.setDetailedData(data);
  highlightMarker(trip);

  if (selectTripId && trip.trip.id == selectTripId) {
    map.setView(trip.marker.getLatLng(), 15);
    trip.marker.openPopup();
    currentRoute?.forEach(layer => layer.remove());
    currentRoute = trip.showRoute();
  }
}

/**
 * Flashes the marker icon to highlight an update.
 */
function highlightMarker(trip: MapTrip) {
  trip.updateMarkerIcon(true);
  setTimeout(() => { trip.updateMarkerIcon(); }, 750);

}

// Animation loop
function animate() {
  trips.values().forEach((trip: MapTrip) => {
    if (!trip.trip.isDetailed) { return; }

    if (trip.trip.isFinished()) {
      if (trip.marker.getPopup()!.isOpen()) {
        currentRoute!.forEach(layer => layer.remove());
        currentRoute = null;
      }
      trip.marker.remove();
      trips.delete(trip.trip.id);

    } else {
      trip.updateMarkerPosition();
    }
  });

  requestAnimationFrame(animate);
}

animate();
