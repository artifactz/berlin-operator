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
  [key: string]: any;
  id: string,
  name: string,
  point: Point,
  segmentPoints: Array<Point>;
  arrival: number | null,
  departure: number | null,
}
