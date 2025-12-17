import { fetchAllTrips, fetchTripDetails } from "./transportAPI.js";
import { addDragZoomCapabilities } from "./svgZoomer.js";
import { Point } from "./types.js"
import type { PreliminaryTripData, DetailedTripData, StopData } from "./types.js"


class Trip {
  data: DetailedTripData;
  stops: Array<StopData>;

  constructor(data: DetailedTripData) {
    this.data = data;
    this.stops = [];
  }

  static fromTripJson(data: DetailedTripData) {
    const trip = new Trip(data);

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
          trip.stops[j - 1]!.segmentPoints.push(point);
          trip.stops[j - 1]!.segmentLength = getSegmentLength(trip.stops[j - 1]!);
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

        trip.stops.push({
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
        trip.stops[j]!.segmentPoints.push(point);
      }
    }

    return trip;
  }

  getPolyline() {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');

      const id = `${this.data.id}_route`;
      polyline.setAttribute('id', id);

      const points = [`${this.stops[0]!.point.x},${this.stops[0]!.point.y}`];
      this.stops.forEach(stop => {
        stop.segmentPoints.forEach(p => {
          points.push(`${p.x},${p.y}`);
        });
      });
      polyline.setAttribute('points', points.join(' '));
      polyline.classList.add('route');

      return polyline;
  }

  isFinished(extraSeconds = 15) {
    const now = Date.now();
    console.assert(this.data.arrival != null);
    return this.data.arrival + extraSeconds * 1000 < now;
  }

  getCurrentPosition() {
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
        return {
          x: p1.x + ratio * dx,
          y: p1.y + ratio * dy,
        }
      } else {
        distanceAlongSegment -= pointDistance;
      }
      p1 = p2;
    }

    console.assert(false, 'Should not reach here');
  }
}

function getPointFromLatLon(lat: number, lon: number, originLat = 52.519170, originLon = 13.409606): Point {
  const METERS_PER_DEG = 40074000 / 360;  // Earth circumference
  const lonScale = Math.cos(originLat / 180 * Math.PI);
  const x = (lon - originLon) * METERS_PER_DEG * lonScale;
  const y = (lat - originLat) * METERS_PER_DEG;
  return {x, y};
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


const svg = document.getElementById('map')!;
addDragZoomCapabilities(svg, { x: -6000, y: -4000, w: 12000, h: 8000 });


function addPreliminaryTrip(data: PreliminaryTripData) {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

  console.assert(document.getElementById(data.id) === null, `Duplicate trip id ${data.id}.`);
  circle.setAttribute('id', data.id);

  circle.classList.add('vehicleInitializing');

  const point = getPointFromLatLon(data.currentLocation.latitude, data.currentLocation.longitude);
  circle.setAttribute('cx', `${point.x}`);
  circle.setAttribute('cy', `${point.y}`);
  circle.setAttribute('r', '40');

  svg.appendChild(circle);
}

function removePreliminaryTrip(data: PreliminaryTripData) {
  const circle = document.getElementById(data.id)!;
  svg.removeChild(circle);
}

/**
 * Adds a "detailed trip" element set up with hover events to the SVG container after its preliminary element was
 * removed.
 */
function addDetailedTrip(trip: Trip) {
  const polyline = trip.getPolyline();

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('id', trip.data.id);
  circle.classList.add('vehicle');

  const pos = trip.getCurrentPosition();
  circle.setAttribute('cx', pos.x);
  circle.setAttribute('cy', pos.y);
  circle.setAttribute('r', '50');

  circle.addEventListener('mouseenter', () => {
    svg.removeChild(circle);
    svg.appendChild(polyline);
    svg.appendChild(circle); // Bring to front
  });
  circle.addEventListener('mouseleave', () => {
    svg.removeChild(polyline);
  });

  // Bring to front
  svg.appendChild(circle);
}


let trips = new Map();

(async () => {
  const fetchTimestamp = Date.now();
  const fetchedTrips = await fetchAllTrips();

  fetchedTrips.forEach((preliminaryData: PreliminaryTripData) => {

    addPreliminaryTrip(preliminaryData);

    fetchTripDetails(preliminaryData).then((detailedData: DetailedTripData) => {
      const trip = Trip.fromTripJson(detailedData);
      removePreliminaryTrip(preliminaryData);

      if (!trip.data.cancelled) {
        if (detailedData.id != preliminaryData.id) {
          console.log(`Updated trip id from ${preliminaryData.id} to ${detailedData.id} after fetching details.`);
        }

        if (trips.has(trip.data.id)) {
          console.log(`Skipping duplicate trip id ${trip.data.id} after fetching details.`);
        } else {
          // Adding a new element brings it to the front
          addDetailedTrip(trip);
          trips.set(trip.data.id, trip);
        }
      }
    });
  });
})();


// Animation loop
function animate() {
  trips.values().forEach(trip => {
    const circle = document.getElementById(trip.data.id)!;
    console.assert(circle !== null);

    if (trip.isFinished()) {
      circle.removeEventListener('mouseenter', () => {});
      circle.removeEventListener('mouseleave', () => {});
      svg.removeChild(circle);
      trips.delete(trip.data.id);

    } else {
      const pos = trip.getCurrentPosition();
      circle.setAttribute("cx", pos.x);
      circle.setAttribute("cy", pos.y);
      circle.classList.remove('vehicleInitializing');
      circle.classList.add('vehicle');
    }
  });

  requestAnimationFrame(animate);
}

animate();
