import { fetchAllTrips, fetchTripDetails } from "./transportAPI.js";
import { Point, LatLon } from "./types.js"
import type { PreliminaryTripData, DetailedTripData, StopData } from "./types.js"

import L, { DivIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import * as lineColors from './colors.json' with { type: 'json' }


class Trip {
  marker: L.Marker;
  data: PreliminaryTripData | DetailedTripData;
  isDetailed: boolean;
  stops: Array<StopData>;

  constructor(data: PreliminaryTripData) {
    this.data = data
    this.isDetailed = false;
    this.stops = [];
    const color = lineColors[this.name] ?? '#555';

    const origin = simplifyStopName(this.data.origin.name);
    const destination = simplifyStopName(this.data.destination.name);
    const popupHtml = `<div class="line-info-container">
  <div class="line-name" style="background-color: ${color}">${this.name}</div>
  <div class="line-grid">
    <div class="line-grid-header">Von:</div>
    <div class="line-grid-data">${origin}</div>
    <div class="line-grid-header">Nach:</div>
    <div class="line-grid-data">${destination}</div>
  </div>
</div>`;

    this.marker = L.marker([data.currentLocation.latitude, data.currentLocation.longitude], {
      icon: this.createIcon()
    })
      .bindPopup(popupHtml)
      .addTo(map);

    this.marker.on('click', (e) => {
      if (currentRoute) { currentRoute.remove(); }
      if (!this.isDetailed) { return; }
      const latLons = this.getRouteLatLons();
      currentRoute = L.polyline(latLons, {color}).addTo(map);
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

  get cancelled(): boolean {
    return this.data.cancelled;
  }

  setData(data: DetailedTripData) {
    this.data = data;
    this.isDetailed = true;

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
  }

  updateMarkerIcon() {
    this.marker.setIcon(this.createIcon());
  }

  createIcon(): L.DivIcon {
    const className = this.isDetailed ? 'vehicle' : 'preliminary-vehicle vehicle';
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
    const now = Date.now();
    console.assert(this.data.arrival != null);
    return this.data.arrival + extraSeconds * 1000 < now;
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

  getRoutePoints() {
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

function simplifyStopName(stopName: string): string {
  if (stopName.endsWith(' (Berlin)')) {
    stopName = stopName.slice(0, -9);
  }
  return stopName;
}


const map = L.map('map').setView([52.52, 13.405], 13);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

map.locate({setView: true, maxZoom: 16});

let trips = new Map();
let currentRoute: L.Polyline | null = null;

map.on('click', (e) => {
  if (currentRoute) { currentRoute.remove(); }
  currentRoute = null;
});


(async () => {
  const fetchTimestamp = Date.now();
  const fetchedTrips = await fetchAllTrips();

  for (const preliminaryData of fetchedTrips) {
    const trip = new Trip(preliminaryData);
    trips.set(preliminaryData.id, trip);

    fetchTripDetails(preliminaryData.id).then((detailedData: DetailedTripData) => {
      if (detailedData.cancelled) {
        trip.marker.remove();
        trips.delete(preliminaryData.id);
        return;  // Abort
      }

      if (detailedData.id != preliminaryData.id) {
        trips.delete(preliminaryData.id);
        if (trips.has(detailedData.id)) {
          console.log(`Removed trip with id ${preliminaryData.id} becaused it resolved to existing trip with id ${detailedData.id}.`);
          return;  // Abort
        } else {
          trips.set(detailedData.id, trip);
          console.log(`Updated trip id from ${preliminaryData.id} to ${detailedData.id}.`);
        }
      }

      trip.setData(detailedData);
      trip.updateMarkerIcon();
    });
  }
})();


// Animation loop
function animate() {
  trips.values().forEach((trip: Trip) => {
    if (!trip.isDetailed) { return; }

    if (trip.isFinished()) {
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
