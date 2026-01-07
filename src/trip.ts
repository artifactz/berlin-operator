import type { PreliminaryTripData, DetailedTripData, StopData, LatLon } from "./types.js"
import { Point } from "./types.js"
import { getLatLonFromPoint, getPointFromLatLon, getSegmentLength } from "./geo.js";
import * as lineColors from './colors.json' with { type: 'json' }


/**
 * Represents a trip, i.e. a vehicle with a location.
 * As soon as detailed data is available (isDetailed = true), trip schedule is used to getCurrentPosition.
 */
export class Trip {
  data: PreliminaryTripData | DetailedTripData;
  detailsTimestamp: number | null = null;
  stops: Array<StopData> = [];

  constructor(data: PreliminaryTripData) {
    this.data = data;
  }

  get name(): string { return this.data.line.name; }
  get id(): string { return this.data.id; }
  get origin(): string { return sanitizeStopName(this.data.origin.name); }
  get destination(): string { return sanitizeStopName(this.data.destination.name); }

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
   * Makes this a detailed trip, enabling getCurrentPosition.
   */
  setDetailedData(data: DetailedTripData) {
    this.data = data;
    this.detailsTimestamp = Date.now();

    let stops: Array<StopData> = [];
    let prevStopId = null;

    // Retrieve stops from polyline
    for (let i = 0; i < data.polyline.features.length; i++) {
      const element = data.polyline.features[i];
      const point = getPointFromLatLon(element.geometry.coordinates[1], element.geometry.coordinates[0]);

      // Check if element is a stop location, but skip consecutive occurrences
      if (element.properties.id && (prevStopId === null || prevStopId != element.properties.id)) {
        if (prevStopId !== null) {
          stops[stops.length - 1]!.segmentPoints.push(point);
        }
        stops.push({
          id: element.properties.id,
          name: element.properties.name,
          point,
          segmentPoints: [],
        });
        prevStopId = element.properties.id;
      } else if (stops.length > 0) {
        stops[stops.length - 1]!.segmentPoints.push(point);
      } else {
        console.warn(`Polyline element without stop id before first stop for trip id ${this.id} (${this.name}).`);
      }
    }

    // Search corresponding stopovers and fill in arrival/departure times
    let completedStopoverIndex = -1;
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]!;
      for (let j = completedStopoverIndex + 1; j < data.stopovers.length; j++) {
        const stopover = data.stopovers[j];

        if ((stop.arrival || stop.departure) && stopover.stop.id != stop.id) { break; }
        if (stopover.stop.id != stop.id) { continue; }

        // In case of multiple (consecutive) stopover occurrences, use earliest arrival and latest departure
        if (!stop.arrival && i > 0) { stop.arrival = Date.parse(stopover.arrival); }
        stop.departure = Date.parse(stopover.departure);
        stop.cancelled = stopover.cancelled || false;

        completedStopoverIndex = j;
      }
    }

    // Filter out stops not found in stopovers
    stops = stops.filter(stop => stop.arrival !== undefined || stop.departure !== undefined);

    // Compute segment lengths
    stops.forEach(stop => { stop.segmentLength = getSegmentLength(stop); });
    this.stops = stops;
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
