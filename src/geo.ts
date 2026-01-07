import { Point, LatLon } from "./types.js"
import type { StopData } from "./types.js"


export function getPointFromLatLon(lat: number, lon: number, originLat = 52.519170, originLon = 13.409606): Point {
  const METERS_PER_DEG = 40074000 / 360;  // Earth circumference
  const lonScale = Math.cos(originLat / 180 * Math.PI);
  const x = (lon - originLon) * METERS_PER_DEG * lonScale;
  const y = (lat - originLat) * METERS_PER_DEG;
  return new Point(x, y);
}

export function getLatLonFromPoint(x: number, y: number, originLat = 52.519170, originLon = 13.409606): LatLon {
  const METERS_PER_DEG = 40074000 / 360;  // Earth circumference
  const lonScale = Math.cos(originLat / 180 * Math.PI);
  const lon = x / (METERS_PER_DEG * lonScale) + originLon;
  const lat = y / METERS_PER_DEG + originLat;
  return new LatLon(lat, lon);
}

export function getSegmentLength(stop: StopData) {
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
