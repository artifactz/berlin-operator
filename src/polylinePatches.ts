import { LatLon } from "./types.js";

/**
 * Replacements for polylines between specific stop pairs on specific lines.
 */
const patches: Map<string, [Array<string>, Array<LatLon>]> = new Map([
  [
    'S+U Gesundbrunnen Bhf (Berlin) - S Bornholmer Str. (Berlin)',
    [
      ['S1', 'S2', 'S25'],
      [
        new LatLon(52.5494, 13.39409),
        new LatLon(52.54958, 13.39528),
        new LatLon(52.54985, 13.39626),
        new LatLon(52.5502, 13.39698),
        new LatLon(52.55082, 13.39778),
        new LatLon(52.55164, 13.39831),
        new LatLon(52.55264, 13.3984),
        new LatLon(52.55358, 13.39814),
        new LatLon(52.55476, 13.39784),
      ]
    ]
  ],
  [
    'S Bornholmer Str. (Berlin) - S+U Gesundbrunnen Bhf (Berlin)',
    [
      ['S1', 'S2', 'S25'],
      [
        new LatLon(52.55358, 13.39814),
        new LatLon(52.55264, 13.3984),
        new LatLon(52.55164, 13.39831),
        new LatLon(52.55082, 13.39778),
        new LatLon(52.5502, 13.39698),
        new LatLon(52.54985, 13.39626),
        new LatLon(52.54958, 13.39528),
        new LatLon(52.5494, 13.39409),
      ]
    ]
  ],
  [
    'S Bornholmer Str. (Berlin) - S Schönholz (Berlin)',
    [
      ['S1', 'S25'],
      [
        new LatLon(52.55836, 13.39735),
        new LatLon(52.56022, 13.39682),
        new LatLon(52.56173, 13.39612),
        new LatLon(52.5636, 13.39447),
        new LatLon(52.56442, 13.39347),
        new LatLon(52.56647, 13.39008),
        new LatLon(52.57145, 13.38111),
      ]
    ]
  ],
  [
    'S Storkower Str. (Berlin) - S+U Frankfurter Allee (Berlin)',
    [
      ['S41', 'S8', 'S85'],
      [
        new LatLon(52.52374, 13.46462),
        new LatLon(52.52305, 13.46786),
        new LatLon(52.52263, 13.46887),
        new LatLon(52.52216, 13.46961),
        new LatLon(52.52142, 13.47036),
        new LatLon(52.51984, 13.4713),
        new LatLon(52.5153, 13.4745),
        new LatLon(52.51492, 13.47462),
      ]
    ]
  ],
  [
    'S+U Frankfurter Allee (Berlin) - S Storkower Str. (Berlin)',
    [
      ['S42', 'S8', 'S85'],
      [
        new LatLon(52.51492, 13.47462),
        new LatLon(52.5153, 13.4745),
        new LatLon(52.51984, 13.4713),
        new LatLon(52.52142, 13.47036),
        new LatLon(52.52216, 13.46961),
        new LatLon(52.52263, 13.46887),
        new LatLon(52.52305, 13.46786),
        new LatLon(52.52374, 13.46462),
        new LatLon(52.52379, 13.46465),
      ]
    ]
  ],
  [
    'S Grünbergallee (Berlin) - S Altglienicke (Berlin)',
    [
      ['S85', 'S9'],
      [
        new LatLon(52.40030, 13.54587),
        new LatLon(52.40130, 13.54844),
        new LatLon(52.40190, 13.54952),
        new LatLon(52.40310, 13.55127),
        new LatLon(52.40380, 13.55181),
        new LatLon(52.40440, 13.55260),
        new LatLon(52.40550, 13.55467),
        new LatLon(52.40600, 13.55634),
      ]
    ]
  ],
  [
    'S Altglienicke (Berlin) - S Grünbergallee (Berlin)',
    [
      ['S85', 'S9'],
      [
        new LatLon(52.40600, 13.55634),
        new LatLon(52.40550, 13.55467),
        new LatLon(52.40440, 13.55260),
        new LatLon(52.40380, 13.55181),
        new LatLon(52.40310, 13.55127),
        new LatLon(52.40190, 13.54952),
        new LatLon(52.40130, 13.54844),
        new LatLon(52.40030, 13.54587),
      ]
    ]
  ],
  [
    'S Bernau-Friedenstal - S Bernau Bhf',
    [
      ['S2'],
      [
        new LatLon(52.6738, 13.5870),
      ]
    ]
  ],
]);


/**
 * @returns a patch for the given stop pair and line name, or null if no patch exists.
 */
export function getPatch(stopName: string, nextStopName: string, lineName: string): Array<LatLon> | null {
  const key = stopName + ' - ' + nextStopName;
  const patch = patches.get(key);
  if (!patch) { return null; }

  const [lineNames, patchedLatLons] = patch;
  if (lineNames.indexOf(lineName) == -1) { return null; }

  return patchedLatLons;
}
