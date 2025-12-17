export class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export interface PreliminaryTripData {
  [key: string]: any;
}

export interface DetailedTripData {
  [key: string]: any;
}

export interface StopData {
  [key: string]: any;
  segmentPoints: Array<Point>;
}

