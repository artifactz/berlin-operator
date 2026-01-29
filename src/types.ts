export class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export class LatLon {
  lat: number;
  lon: number;
  constructor(lat: number, lon: number) {
    this.lat = lat;
    this.lon = lon;
  }
}

/**
 * Data returned by fetchAllTrips.
 */
export interface PreliminaryTripData {
  [key: string]: any;
}

/**
 * Data returned by fetchTripDetails.
 */
export interface DetailedTripData {
  [key: string]: any;
  notModified?: boolean;
}

export interface StopData {
  id: string;
  name: string;
  cancelled: boolean;
  latLon: LatLon;
  point: Point;
  segmentLatLons: Array<LatLon>;
  segmentPoints: Array<Point>;
  segmentLength: number;
  arrival: number | null;
  departure: number | null;
}
