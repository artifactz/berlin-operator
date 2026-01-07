import { burst, fetchAllTrips, fetchTripDetails, updateRequestQueue } from "./transportAPI.js";
import { Point, LatLon } from "./types.js"
import type { PreliminaryTripData, DetailedTripData, StopData } from "./types.js"

import L, { DivIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import * as lineColors from './colors.json' with { type: 'json' }


/**
 * Represents a trip on the map, i.e. a vehicle with a location.
 * As soon as detailed data is available (isDetailed = true), stops data is used to getCurrentPosition.
 */
class Trip {
  marker: L.Marker;
  data: PreliminaryTripData | DetailedTripData;
  detailsTimestamp: number | null = null;
  stops: Array<StopData> = [];

  constructor(data: PreliminaryTripData) {
    this.data = data;

    const origin = sanitizeStopName(this.data.origin.name);
    const destination = sanitizeStopName(this.data.destination.name);
    const popupHtml = `<div class="line-info-container">
  <div class="line-name" style="background-color: ${this.color}">${this.name}</div>
  <div class="line-grid">
    <div class="line-grid-header">Von:</div>
    <div class="line-grid-data">${origin}</div>
    <div class="line-grid-header">Nach:</div>
    <div class="line-grid-data">${destination}</div>
  </div>
  <div id="trip-share-link" class="trip-share">
    <span class="material-symbols-outlined">share</span>
    Link
  </div>
</div>`;

    this.marker = L.marker([data.currentLocation.latitude, data.currentLocation.longitude], {
      icon: this.createIcon()
    })
      .bindPopup(popupHtml)
      .addTo(map)
      .on('popupopen', (e: L.PopupEvent) => {
        if (currentRoute) { currentRoute.forEach(layer => layer.remove()); }
        if (this.isDetailed) { currentRoute = this.showRoute(); }

        const popupEl = e.popup.getElement() as HTMLElement | null;
        if (!popupEl) { return; }
        const btn = popupEl.querySelector('#trip-share-link') as HTMLElement | null;
        if (!btn) { return; }
        const handler = (ev: Event) => {
          ev.preventDefault();
          shareTrip(this.id);
        };
        btn.addEventListener('click', handler);
        this.marker.once('popupclose', () => btn.removeEventListener('click', handler));
      })
      .on('popupclose', (e: L.PopupEvent) => {
        if (currentRoute) { currentRoute.forEach(layer => layer.remove()); }
        currentRoute = null;
      });
  }

  get emoji(): string {
    const product = this.data.line.product;
    return (product == 'suburban')
      ? '🚈'
      : (product == 'subway')
        ? '🚇'
        : (product == 'tram')
          ? '🚋'
          : (product == 'bus')
            ? '🚌'
            : (product == 'ferry')
              ? '🛥️'
              : '🐒';  // Unknown transit product
  }

  get name(): string {
    return this.data.line.name;
  }

  get id(): string {
    return this.data.id;
  }

  get color(): string {
    return lineColors[this.name] ?? '#555';
  }

  get cancelled(): boolean {
    return this.data.cancelled;
  }

  get departure(): number {
    console.assert(this.data.departure != null);
    return Date.parse(this.data.departure);
  }

  get arrival(): number {
    console.assert(this.data.arrival != null);
    return Date.parse(this.data.arrival);
  }

  get isDetailed(): boolean {
    return this.detailsTimestamp !== null;
  }

  /**
   * Makes this a detailed trip enabling getCurrentPosition.
   */
  setData(data: DetailedTripData) {
    this.data = data;
    this.detailsTimestamp = Date.now();
    this.stops = [];

    // Iterate polyline and stopover items in parallel
    let j = -1;
    let lastStopId = null;
    for (let i = 0; i < data.polyline.features.length; i++) {
      const element = data.polyline.features[i];

      const point = getPointFromLatLon(element.geometry.coordinates[1], element.geometry.coordinates[0]);

      // Check if an entry is a stop location, but skip consecutive occurrences
      if (element.properties.id && (lastStopId === null || lastStopId != element.properties.id)) {
        j++;

        if (j > 0) {
          this.stops[j - 1]!.segmentPoints.push(point);
          this.stops[j - 1]!.segmentLength = getSegmentLength(this.stops[j - 1]!);
        }

        const stop = data.stopovers[j];
        const stationPoint = getPointFromLatLon(stop.stop.location.latitude, stop.stop.location.longitude);

        let arrival = Date.parse(stop.arrival);
        let departure = Date.parse(stop.departure);
        if (arrival == departure) {
          // A stop takes at least 15 seconds
          arrival -= 7500;
          departure += 7500;
        }

        this.stops.push({
          id: stop.stop.id,
          name: stop.stop.name,
          latitude: stop.stop.location.latitude,
          longitude: stop.stop.location.longitude,
          stationPoint,
          point,
          arrival,
          departure,
          segmentPoints: [],
          cancelled: stop.cancelled || false,
        });

        lastStopId = element.properties.id;

      } else {
        this.stops[j]!.segmentPoints.push(point);
      }
    }

    if (this.stops[this.stops.length - 1]!.arrival != this.arrival) {
      console.warn(`Mismatch between last stop arrival ${this.stops[this.stops.length - 1]!.arrival} and trip arrival ${this.arrival} for trip id ${this.id} (${this.name}).`);
    }
  }

  /**
   * Displays the full route of this trip on the map.
   * @returns Array of created Leaflet layers (polyline and stop markers).
   */
  showRoute(): Array<L.Layer> {
    const color = this.color;
    const polylineLatLons = this.getRouteLatLons();
    const polyline = L.polyline(polylineLatLons, {color}).addTo(map);
    const stopLatLons = this.getStopLatLons();
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
    const className = (!this.isDetailed)
      ? 'preliminary-vehicle vehicle'
      : highlightUpdate
        ? 'updated-vehicle vehicle'
        : 'vehicle';
    return L.divIcon({
      className,
      html: `<div>${this.emoji}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  updateMarkerPosition() {
    const latLon = this.getCurrentLatLon();
    this.marker.setLatLng([latLon.lat, latLon.lon]);
  }

  isFinished(extraSeconds = 15) {
    return this.arrival + extraSeconds * 1000 < Date.now();
  }

  getCurrentPosition(): Point {
    const now = Date.now();
    let fromStop = this.stops[0]!;
    let toStop = this.stops[this.stops.length - 1]!;
    for (let i = 1; i < this.stops.length; i++) {
      const stop = this.stops[i]!;
      if (stop.cancelled) { continue; }
      if ((stop.arrival && stop.arrival <= now) || (stop.departure && stop.departure <= now)) {
        fromStop = stop;
      }
      if (stop.arrival && stop.arrival > now) {
        toStop = stop;
        break;
      }
    }

    if (fromStop === toStop || fromStop.departure >= now) {
      return fromStop.point;
    }

    // TODO handle merge of points on cancelled stop

    const segmentDuration = toStop.arrival - fromStop.departure;
    const timeIntoSegment = now - fromStop.departure;
    const segmentProgress = timeIntoSegment / segmentDuration;

    console.assert(segmentProgress > 0 && segmentProgress < 1);

    // Find position along segment points
    let distanceAlongSegment = segmentProgress * fromStop.segmentLength;
    let p1 = fromStop.point;
    for (let i = 0; i < fromStop.segmentPoints.length; i++) {
      const p2 = fromStop.segmentPoints[i]!;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const pointDistance = Math.sqrt(dx * dx + dy * dy);
      if (distanceAlongSegment <= pointDistance) {
        const ratio = distanceAlongSegment / pointDistance;
        return new Point(
          p1.x + ratio * dx,
          p1.y + ratio * dy,
        )
      } else {
        distanceAlongSegment -= pointDistance;
      }
      p1 = p2;
    }

    console.assert(false, 'Should not reach here');
    return new Point(0, 0);
  }

  getCurrentLatLon(): LatLon {
    const point = this.getCurrentPosition();
    return getLatLonFromPoint(point.x, point.y);
  }

  getStopPoints(): Array<Point> {
    return this.stops.map(stop => stop.point);
  }

  getStopLatLons(): Array<[number, number]> {
    return this.getStopPoints().map(p => {
      const latLon = getLatLonFromPoint(p.x, p.y);
      return [latLon.lat, latLon.lon];
    });
  }

  getRoutePoints(): Array<Point> {
    const points = [this.stops[0]!.point];
    this.stops.forEach(stop => { stop.segmentPoints.forEach(p => { points.push(p); }); });
    return points;
  }

  getRouteLatLons(): Array<[number, number]> {
    return this.getRoutePoints().map(p => {
      const latLon = getLatLonFromPoint(p.x, p.y);
      return [latLon.lat, latLon.lon];
    });
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

function getPointFromLatLon(lat: number, lon: number, originLat = 52.519170, originLon = 13.409606): Point {
  const METERS_PER_DEG = 40074000 / 360;  // Earth circumference
  const lonScale = Math.cos(originLat / 180 * Math.PI);
  const x = (lon - originLon) * METERS_PER_DEG * lonScale;
  const y = (lat - originLat) * METERS_PER_DEG;
  return new Point(x, y);
}

function getLatLonFromPoint(x: number, y: number, originLat = 52.519170, originLon = 13.409606): LatLon {
  const METERS_PER_DEG = 40074000 / 360;  // Earth circumference
  const lonScale = Math.cos(originLat / 180 * Math.PI);
  const lon = x / (METERS_PER_DEG * lonScale) + originLon;
  const lat = y / METERS_PER_DEG + originLat;
  return new LatLon(lat, lon);
}

function getSegmentLength(stop: StopData) {
  let length = 0;
  let p1 = stop.point;
  for (let i = 0; i < stop.segmentPoints.length; i++) {
    const p2 = stop.segmentPoints[i]!;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    length += Math.sqrt(dx * dx + dy * dy);
    p1 = p2;
  }
  return length;
}

/**
 * Makes a stop name ready for display by removing unnecessary suffixes and making slashes breakable.
 */
function sanitizeStopName(stopName: string): string {
  if (stopName.endsWith(']')) {
    const bracketIndex = stopName.lastIndexOf(' [');
    if (bracketIndex != -1) {
      stopName = stopName.slice(0, bracketIndex);
    }
  }
  if (stopName.endsWith(' (Berlin)')) {
    stopName = stopName.slice(0, -9);
  }
  stopName = stopName.replaceAll('/', '&hairsp;/&hairsp;');
  return stopName;
}


const map = L.map('map').setView([52.52, 13.405], 13);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const urlParams = new URLSearchParams(window.location.search);
const selectTripId = urlParams.get('trip')?.replaceAll('-', '|');

if (!selectTripId) { map.locate({setView: true, maxZoom: 15}); }

let trips = new Map<string, Trip>();
let currentRoute: Array<L.Layer> | null = null;

map.on('click', (e) => {
  if (currentRoute) { currentRoute.forEach(layer => layer.remove()); }
  currentRoute = null;
});


let fetchNewTripsTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Fetches preliminary data for all trips, adds new ones, and schedules a detailed data request for them.
 */
function fetchNewTrips() {
  console.log('Fetching new trips...');
  fetchAllTrips((preliminaryData) => {
    if (trips.has(preliminaryData.id)) {
      // console.log(`Skipping duplicate preliminary trip with id ${preliminaryData.id}.`);
      return;
    }
    const trip = new Trip(preliminaryData);
    trips.set(preliminaryData.id, trip);

    if (selectTripId && trip.id == selectTripId) {
      map.setView(trip.marker.getLatLng(), 15);
    }

    fetchTripDetails(preliminaryData.id, (detailedData) => {
      onDetailedData(trip, detailedData);
    });
  }, () => {
    updateRequestOrder();
  });
}

fetchNewTrips();
fetchNewTripsTimer = setInterval(() => {
  fetchNewTrips();
}, 90000);  // Fetch new trips every 90 seconds


let updateRequestOrderTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Updates the request queue to fetch detailed trip data in order of proximity to the map center and time since last
 * update.
 */
function updateRequestOrder() {
  const queue = [];
  const center = map.getCenter();
  for (const trip of trips.values()) {
    const distanceMeters = map.distance(center, trip.marker.getLatLng());
    let priority = distanceMeters;  // Requests with lower priority value are executed first
    if (trip.isDetailed) {
      const ageSeconds = (Date.now() - trip.detailsTimestamp!) / 1000;
      if (ageSeconds < 1) {
        continue;
      }
      priority += 5000 - 50 * ageSeconds;
    }
    queue.push({trip, priority});
  }
  queue.sort((a, b) => a.priority - b.priority);
  updateRequestQueue(queue.map(item => item.trip.id), (id, detailedData) => {
    const trip = trips.get(id);
    if (!trip) {
      console.warn(`Received detailed data for unknown trip id ${id}.`);
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
function onDetailedData(trip: Trip, data: DetailedTripData) {
  if (data.notModified) {
    trip.detailsTimestamp = Date.now();
    highlightMarker(trip);
    return;
  }

  if (data.cancelled) {
    trip.marker.remove();
    trips.delete(trip.id);
    return;  // Abort
  }

  if (data.id != trip.id) {
    trips.delete(trip.id);
    if (trips.has(data.id)) {
      console.log(`Removed trip with id ${trip.id} becaused it resolved to existing trip with id ${data.id}.`);
      return;  // Abort
    } else {
      trips.set(data.id, trip);
      console.log(`Updated trip id from ${trip.id} to ${data.id}.`);
    }
  }

  trip.setData(data);
  highlightMarker(trip);

  if (selectTripId && trip.id == selectTripId) {
    map.setView(trip.marker.getLatLng(), 15);
    trip.marker.openPopup();
    currentRoute?.forEach(layer => layer.remove());
    currentRoute = trip.showRoute();
  }
}

/**
 * Flashes the marker icon to highlight an update.
 */
function highlightMarker(trip: Trip) {
  trip.updateMarkerIcon(true);
  setTimeout(() => { trip.updateMarkerIcon(); }, 750);

}


map.on('moveend zoomend', () => {
  updateRequestOrder();
  burst();
});


// Animation loop
function animate() {
  trips.values().forEach((trip: Trip) => {
    if (!trip.isDetailed) { return; }

    if (trip.isFinished()) {
      if (trip.marker.getPopup()!.isOpen()) {
        currentRoute!.forEach(layer => layer.remove());
        currentRoute = null;
      }
      trip.marker.remove();
      trips.delete(trip.data.id);

    } else {
      const latlon = trip.getCurrentLatLon();
      trip.marker.setLatLng([latlon.lat, latlon.lon]);
    }
  });

  requestAnimationFrame(animate);
}

animate();
