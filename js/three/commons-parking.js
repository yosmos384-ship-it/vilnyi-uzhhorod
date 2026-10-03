// ЖК VILNYI (Uzhhorod) — the shared underground parking level (−4.200) under all four towers. Task T15.
//
//   export function buildTowerParking(KIT, bId) → CommonsResult      (CONTRACT §4.2)
//
// One basement for the whole complex: 155 places = 82 (compartment 1, west) + 73 (compartment 2, east) of the fire wall,
// two ramps (no car lifts), 8 lifts (two per tower) and the stairs come down into it; it doubles as the shelter.
// Everything is modelled in WORLD coordinates in a sub-group offset by −origin of the tower the walker is in, so the
// same geometry appears whichever tower's parking view is built. Local y = 0 is the parking floor (root sits at
// floorY(bId, −1)); the ground (±0.000) is at y = −PARKING.y.
//
// Geometry sources: PARKING (outline, fire wall, gates, cores), RAMPS, coresOf(b, 1) (lift doors projected down) from
// data.js. What data.js does not carry — the drawn bays, the columns and the enclosed room blocks — is the table P21
// below, read from plans.pdf p.21 (site metres; world = site − SITE.originSite).
import * as THREE from 'three';
import { BUILDINGS, B_IDS, PARKING, RAMPS, SITE, coresOf, floorY, localToWorld, worldToLocal } from '../data.js';

// ------------------------------------------------------------------ plan table (plans.pdf p.21, site metres)
const P21 = {
  // parking bays as drawn: [centre x, centre z, axis (0 = car along x, 1 = along z), length, width]; west compartment first
  bays: [
    [2.45,3.25,1,5.1,2.7],[1.6,15.45,1,5.7,2.8],[2.6,20.55,0,4.2,2.7],[2.6,23.25,0,4.2,2.7],[2.6,26.85,0,4.2,2.7],[2.6,29.55,0,4.2,2.7],
    [2.6,32.9,0,4.2,2.8],[2.6,36.85,0,4.2,2.7],[2.6,39.55,0,4.2,2.7],[2.6,42.25,0,4.2,2.7],[2.6,44.95,0,4.2,2.7],[5.55,3.25,1,5.1,2.9],
    [13.05,3.65,1,5.1,2.9],[10.2,4.35,1,4.1,2.6],[5.8,14,0,5.6,2.85],[5.8,16.9,0,5.6,2.85],[6.8,20.55,0,4.2,2.7],[6.8,23.25,0,4.2,2.7],
    [6.8,26.85,0,4.2,2.7],[6.8,29.55,0,4.2,2.7],[6.8,32.9,0,4.2,2.8],[6.8,36.85,0,4.2,2.7],[6.8,39.55,0,4.2,2.7],[6.8,42.25,0,4.2,2.7],
    [6.8,44.95,0,4.2,2.7],[6.3,54.75,0,5.2,2.7],[6.3,57.45,0,5.2,2.7],[6.3,61.5,0,5.2,2.75],[6.3,64.2,0,5.2,2.75],[6.3,68.55,0,5.2,2.7],
    [6.3,73.15,0,5.2,2.7],[6.3,77.2,0,5.2,2.6],[6.3,81.5,0,5.2,2.6],[20.05,4.15,1,4.9,2.65],[17.45,29.2,0,4.9,2.8],[16.3,34.35,1,5.1,2.6],
    [18.9,34.35,1,5.1,2.6],[18.55,40.6,0,4.9,2.8],[18,45.5,1,4.8,2.84],[20.85,45.5,1,4.8,2.84],[17.75,56.1,1,4,2.7],[20.7,56.1,1,4,2.6],
    [17.75,60.1,1,4,2.7],[20.7,60.1,1,4,2.6],[25.95,4.05,1,4.7,2.7],[22.7,4.15,1,4.9,2.65],[28.2,25.8,0,5.2,2.6],[23.95,28,1,4.8,2.7],
    [28.2,28.4,0,5.2,2.6],[27.9,37.95,0,5.2,2.7],[22.55,39.05,1,5.5,2.9],[27.9,41.2,0,5.2,2.6],[23.7,45.5,1,4.8,2.84],[26.55,45.5,1,4.8,2.84],
    [29.4,45.5,1,4.8,2.84],[23.3,56.1,1,4,2.6],[26.3,56.4,1,4.8,2.85],[29.2,56.4,1,4.8,2.85],[23.3,60.1,1,4,2.6],[27.75,60.15,0,5.7,2.7],
    [28.3,75.55,0,4.8,2.5],[28.3,78.05,0,4.8,2.5],[39.35,21.05,0,4.7,2.7],[39.35,24,0,4.7,2.6],[39.35,26.6,0,4.7,2.6],[39.35,29.6,0,4.7,2.6],
    [39.35,32.2,0,4.7,2.6],[39.35,35.2,0,4.7,2.6],[39.35,37.8,0,4.7,2.6],[39.35,40.8,0,4.7,2.6],[39.35,43.4,0,4.7,2.6],[39.35,46.4,0,4.7,2.8],
    [39.35,50.8,0,4.7,2.85],[39.35,53.65,0,4.7,2.85],[39.35,57.6,0,4.7,2.6],[39.35,60.2,0,4.7,2.6],[39.35,63.2,0,4.7,2.6],[39.35,65.8,0,4.7,2.6],
    [39.35,71.35,0,4.7,2.7],[39.35,74.4,0,4.7,2.6],[39.35,77,0,4.7,2.6],[39.35,89.35,0,4.7,2.7],[45,3.9,0,5.2,2.78],[45,6.65,0,5.2,2.78],
    [45,9.45,0,5.2,2.78],[45,12.25,0,5.2,2.78],[45,15,0,5.2,2.78],[45,20.8,0,5.2,2.8],[45,23.6,0,5.2,2.8],[45,26.4,0,5.2,2.8],[45,29.2,0,5.2,2.8],
    [45,32,0,5.2,2.8],[45,34.8,0,5.2,2.8],[45,37.6,0,5.2,2.8],[45,40.4,0,5.2,2.8],[45,43.2,0,5.2,2.8],[44.95,46.35,0,4.9,2.7],[44.9,54.5,0,4.8,2.6],
    [44.95,57.5,0,4.9,2.6],[44.95,60.1,0,4.9,2.6],[44.9,63.1,0,4.8,2.6],[44.9,65.7,0,4.8,2.6],[44.95,68.9,0,4.9,2.6],[44.95,71.5,0,4.9,2.6],
    [44.9,74.5,0,4.8,2.6],[44.9,77.1,0,4.8,2.6],[45.4,86.8,0,4.8,2.6],[45.4,89.4,0,4.8,2.6],[55.75,1.4,0,4.3,2.45],[55.75,3.9,0,4.3,2.45],
    [55.75,7.35,0,4.3,2.45],[55.75,9.8,0,4.3,2.45],[56.05,15.8,0,4.9,2.6],[55.85,18.55,0,4.1,2.45],[55.85,21,0,4.1,2.45],[55.85,24.15,0,4.1,2.45],
    [55.85,26.6,0,4.1,2.45],[54.7,42.35,1,4.9,2.77],[57.45,42.35,1,4.9,2.77],[55.85,49.45,0,4.9,2.5],[55.25,53.65,0,4.9,2.65],[55.25,56.3,0,4.9,2.65],
    [55.25,61.65,0,4.9,2.65],[55.25,64.3,0,4.9,2.65],[55.25,70.6,0,4.9,2.8],[56.15,87,0,4.7,2.6],[56.15,89.6,0,4.7,2.6],[60.25,42.35,1,4.9,2.77],
    [63,42.35,1,4.9,2.77],[65.8,42.35,1,4.9,2.77],[60.6,70.75,1,5.5,2.8],[63.8,70.75,1,5.5,2.8],[60.05,76.2,1,4.8,2.9],[63.55,76.2,1,4.8,2.9],
    [68.55,42.35,1,4.9,2.77],[71.35,42.35,1,4.9,2.77],[74.1,42.35,1,4.9,2.77],[76.45,47.15,0,5.5,2.7],[76.45,49.85,0,5.5,2.7],[76.45,57.25,0,5.5,2.7],
    [69.3,66.9,1,4.8,2.65],[72,68.9,1,4.8,2.65],[67.75,75.55,1,5.5,2.9],[71.25,75.55,1,5.5,2.9],[75.1,76.25,1,4.9,2.55],[72.7,87.4,1,5.2,2.57],
    [75.25,87.4,1,5.2,2.57],[69.35,87.55,1,5.5,2.7],[77.25,43.05,1,5.5,2.9],[77.05,54.2,0,4.7,2.8],[76.75,68.05,0,5.5,2.7],[76.75,70.75,0,5.5,2.7],
    [77.8,87.4,1,5.2,2.57],[81.1,87.7,1,5.2,2.75],[83.85,87.7,1,5.2,2.75]
  ],
  // free-standing columns and pylons as drawn: [centre x, centre z, size x, size z]
  cols: [
    [-2.1,53.83,1.14,1.01],[-1.91,46.59,1.53,1.07],[-0.74,46.24,0.87,0.38],[-0.15,-0.09,0.3,0.3],[1.65,91.14,0.3,0.3],[3.85,5.63,0.5,0.5],
    [3.85,12.56,0.5,0.5],[3.85,18.85,0.5,0.5],[3.85,25.15,0.5,0.5],[3.85,31.45,0.5,0.5],[3.85,34.6,0.5,0.5],[3.85,41.1,0.5,0.5],[6.23,89.29,0.5,0.5],
    [6.64,83.89,0.5,0.5],[6.89,79.41,0.5,0.5],[7.1,2.06,0.5,0.5],[7.1,6.26,0.5,0.5],[7.1,12.56,0.5,0.5],[7.1,18.85,0.5,0.5],[7.1,25.15,0.5,0.5],
    [7.1,31.45,0.5,0.5],[7.1,34.6,0.5,0.5],[7.1,37.31,0.5,0.5],[7.35,75.39,0.5,0.5],[7.73,70.59,0.5,0.5],[8.1,41.1,0.5,0.5],[8.12,66.1,0.5,0.5],
    [8.29,89.29,0.6,0.6],[8.39,79.41,0.6,0.6],[8.54,83.89,1.5,0.3],[8.6,6.26,0.6,0.6],[8.6,12.56,0.6,0.6],[8.6,18.85,0.6,0.6],[8.6,25.15,0.6,0.6],
    [8.6,31.45,0.6,0.6],[8.6,34.6,0.6,0.6],[8.85,75.39,0.6,0.6],[8.89,59.3,0.5,0.5],[9.23,70.59,0.6,0.6],[9.62,66.1,0.6,0.6],[11.29,2.06,0.6,0.6],
    [12.19,83.89,1.5,0.3],[12.19,90.84,0.6,0.3],[14.41,17.25,0.8,0.3],[15.27,62.46,0.63,0.33],[15.89,36.9,0.4,0.4],[15.89,38.6,0.5,0.5],
    [16.32,43.31,0.5,0.5],[16.32,47.66,0.5,0.5],[16.32,54.25,0.5,0.5],[16.32,60.63,0.5,0.5],[16.64,83.89,1.5,0.3],[16.64,90.84,0.6,0.3],
    [19.29,43.31,0.5,0.5],[19.29,47.66,0.5,0.5],[19.29,54.25,0.5,0.5],[19.29,60.63,0.5,0.5],[19.39,37.15,0.6,0.6],[19.39,38.95,0.5,0.5],
    [19.5,16.78,0.63,1.5],[19.61,61.85,0.83,0.36],[19.79,19.55,0.97,1.8],[19.94,21.54,0.68,0.53],[20.01,12.56,0.6,0.6],[21.19,83.89,1.5,0.3],
    [21.19,90.84,0.6,0.3],[21.99,59.83,0.5,0.5],[22.09,91.14,1.2,0.3],[22.84,91.14,0.3,0.3],[23.89,91.14,1.8,0.3],[24.29,2.98,0.82,0.32],
    [24.29,5.76,0.6,0.6],[24.88,39.76,0.5,0.5],[24.88,43.31,0.5,0.5],[24.88,47.66,0.5,0.5],[24.88,54.25,0.5,0.5],[24.89,59.83,0.5,0.5],
    [24.99,36.39,0.47,0.83],[25.07,83.89,1.5,0.3],[25.09,90.84,0.6,0.3],[25.44,30.06,0.65,0.65],[25.69,61.3,0.6,0.3],[26.5,36.39,0.54,0.54],
    [26.95,30.06,0.54,0.54],[26.98,12.54,0.65,0.65],[27.49,23.79,0.54,0.54],[27.55,5.96,0.6,0.6],[28.03,3.43,0.54,0.54],[28.48,12.54,0.54,0.54],
    [28.54,89.29,0.6,0.6],[28.64,83.89,1.5,0.3],[28.98,18.17,0.5,0.5],[29.01,6.5,0.54,0.54],[29.09,66.11,0.6,0.6],[29.09,79.29,0.6,0.35],
    [29.3,1.63,0.3,0.32],[29.36,0.78,0.42,1.43],[29.45,-0.09,0.3,0.3],[29.59,24.46,0.5,0.5],[30.49,30.05,0.5,0.5],[30.49,36.39,0.5,0.5],
    [30.49,39.76,0.5,0.5],[30.49,43.31,0.5,0.5],[30.49,47.66,0.5,0.5],[30.49,54.25,0.5,0.5],[30.49,58.91,0.5,0.5],[30.49,61.61,0.5,0.5],
    [30.49,67.21,0.5,0.5],[30.49,72.8,0.5,0.5],[30.49,79.46,0.5,0.5],[30.49,83.89,0.6,0.3],[30.49,87.74,0.5,0.5],[33.91,3.94,0.54,0.54],
    [33.94,11.21,0.5,0.5],[33.94,18.17,0.5,0.5],[37.09,22.42,0.5,0.5],[37.09,28.02,0.5,0.5],[37.09,33.62,0.5,0.5],[37.09,39.22,0.5,0.5],
    [37.09,44.81,0.5,0.5],[37.09,49.16,0.5,0.5],[37.09,52.11,0.5,0.5],[37.09,56.01,0.5,0.5],[37.09,61.61,0.5,0.5],[37.09,67.21,0.5,0.5],
    [37.09,72.8,0.5,0.5],[37.09,78.4,0.5,0.5],[38.48,86.29,0.5,0.5],[39.93,18.17,0.5,0.5],[40.13,4.49,0.54,0.54],[42.04,18.34,0.35,0.35],
    [42.04,91.59,0.35,0.35],[42.37,11.21,0.61,0.5],[47.09,44.79,0.5,0.5],[47.09,49.17,0.5,0.5],[47.09,52.67,0.5,0.5],[47.09,56.01,0.5,0.5],
    [47.09,61.61,0.5,0.5],[47.09,67.21,0.5,0.5],[47.09,72.8,0.5,0.5],[47.09,77.91,0.5,0.5],[47.29,5.63,0.5,0.5],[47.29,11.21,0.5,0.5],
    [47.29,16.81,0.5,0.5],[47.29,22.42,0.5,0.5],[47.29,28.02,0.5,0.5],[47.29,33.64,0.5,0.5],[47.29,39.24,0.5,0.5],[47.58,85.29,0.5,0.5],
    [50.68,91.09,0.5,0.5],[53.08,52.02,0.5,0.5],[53.08,59.92,0.5,0.5],[53.08,67.07,0.5,0.5],[53.08,72.01,0.5,0.5],[53.28,40.22,0.5,0.5],
    [53.28,45.3,0.5,0.5],[53.88,5.38,0.5,0.5],[53.88,11.23,0.5,0.5],[53.88,17.07,0.5,0.5],[53.88,22.42,0.5,0.5],[53.88,28.02,0.5,0.5],
    [53.88,33.42,0.5,0.5],[53.88,85.29,0.5,0.5],[53.88,91.09,0.5,0.5],[54.36,72.31,0.35,0.8],[54.38,77.54,0.5,0.5],[54.53,52.02,0.7,0.7],
    [54.53,59.92,0.7,0.8],[54.53,67.02,0.7,0.7],[55.28,11.23,0.5,0.5],[55.78,5.38,0.5,0.5],[55.88,17.07,0.5,0.5],[56.58,22.42,0.5,0.5],
    [57.07,11.45,0.59,0.85],[57.43,47.18,0.82,0.36],[57.53,46.32,0.5,0.5],[57.54,15.3,0.59,0.85],[58.06,33.42,0.5,0.5],[58.22,77.54,0.5,0.5],
    [58.23,76.18,0.62,0.62],[58.4,3.94,0.4,0.8],[58.43,22.69,0.25,1.02],[58.53,-0.11,0.35,0.35],[58.53,1,0.35,1.88],[58.88,40.22,0.5,0.5],
    [61.74,66.97,0.35,0.8],[61.76,59.92,0.3,0.9],[61.79,63.57,0.25,1],[61.84,56.47,0.35,0.8],[61.87,11.44,0.4,1.5],[61.87,14.81,0.4,0.54],
    [61.87,15.2,0.4,0.25],[61.87,15.68,0.4,0.71],[61.87,19.77,0.4,1.5],[61.91,46.75,0.5,0.5],[62.14,70.01,0.45,0.8],[62.21,4.29,0.3,1.5],
    [64.48,40.22,0.5,0.5],[64.48,44.81,0.5,0.5],[65.96,77.46,0.5,0.5],[65.97,76.4,0.72,0.72],[66.05,33.42,0.5,0.5],[66.35,11.48,0.6,0.6],
    [66.35,15.33,0.6,0.6],[68.37,47.29,0.5,0.5],[68.79,48.44,0.3,0.8],[68.92,22.95,0.6,0.6],[69.54,55.32,0.6,0.6],[69.81,70.01,0.35,0.8],
    [70.07,40.22,0.5,0.5],[70.08,42.22,0.5,0.5],[71.17,85.29,0.5,0.5],[71.17,90.89,0.5,0.5],[72.23,48.45,0.82,0.32],[72.4,33.42,0.5,0.5],
    [72.4,47.61,0.5,0.5],[73,28.02,0.5,0.5],[73.45,26.04,0.83,0.47],[73.53,59.22,0.6,0.6],[73.53,66.42,0.6,0.6],[73.62,22.34,0.3,1],[73.63,77.76,0.5,0.5],
    [73.66,76.72,0.62,0.62],[73.71,70.01,0.35,0.8],[75.58,52.41,0.4,0.83],[75.63,40.22,0.5,0.5],[75.63,44.11,0.5,0.5],[76.12,11.48,0.7,0.7],
    [76.43,52.35,0.56,0.56],[76.44,59.23,0.35,0.82],[77.27,59.22,0.56,0.56],[77.32,3.84,0.6,0.6],[77.33,66.43,0.35,0.82],[77.59,17.69,0.7,0.7],
    [77.86,33.42,0.5,0.5],[77.89,26.43,0.83,0.47],[77.97,22.63,0.6,0.6],[78.16,66.43,0.56,0.56],[78.21,73.82,0.4,0.83],[78.22,28.22,0.5,0.5],
    [79.02,40.22,0.5,0.5],[79.02,45.45,0.5,0.5],[79.03,77.76,0.5,0.5],[79.05,73.71,0.56,0.56],[79.22,52.01,0.5,0.5],[79.57,85.29,0.5,0.5],
    [79.57,90.64,0.5,0.5],[82.26,26.86,0.82,0.37],[82.37,3.84,0.6,0.6],[82.37,7.63,0.6,0.6],[82.37,11.48,0.6,0.6],[82.37,15.38,0.6,0.6],
    [82.37,19.99,0.8,0.4],[82.37,28.62,0.5,0.5],[82.37,33.42,0.5,0.5],[85.37,15.39,0.6,0.6],[85.37,19.88,0.6,0.6],[85.53,7.65,0.36,0.82],
    [85.62,50.51,0.5,0.5],[85.65,11.59,0.56,0.8],[85.82,55.66,0.5,0.5],[85.82,59.22,0.5,0.5],[86.12,66.35,0.5,0.5],[86.12,73.49,0.5,0.5],
    [86.12,78.36,0.5,0.5],[86.12,85.29,0.5,0.5],[86.19,27.57,0.35,0.35],[86.32,2.16,0.35,0.35],[86.32,10,0.35,0.35],[86.82,10,0.35,0.35],
    [86.82,27.57,0.35,0.35]
  ],
  // enclosed (non-parking) blocks [x0, z0, x1, z1]: core blocks, heat substations, pump rooms and fire-water tanks,
  // pool technical basement, transformer basement, vent chambers, supermarket stair; walkable rooms are carved out below
  blocks: [
    [58.0, 1.9, 86.7, 11.9], [63.5, 11.9, 86.7, 14.95], [66.4, 14.95, 86.7, 18.5], [78.3, 18.5, 86.7, 22.4],   // building 1 block + tanks
    [66.4, 18.5, 78.3, 22.4], [66.4, 22.4, 86.1, 33.55],                                                     // envelope of the shelter premises
    [58.1, 30.5, 58.4, 33.6], [66.1, 29.5, 66.4, 33.6], [64.9, 33.35, 66.4, 33.6],                           // walls at the foot of ramp 1
    [14.8, 12.1, 30.5, 24.2], [14.8, 24.2, 22.3, 27.4], [27.5, 0.05, 41.9, 18.4],                             // building 3 block, pool basement
    [15.0, 62.1, 29.5, 70.4], [16.5, 70.4, 29.5, 74.0], [16.5, 74.0, 26.5, 79.7], [15.0, 87.8, 31.2, 91.35],   // building 4 block, rooms south of ramp 2
    [59.2, 45.3, 73.6, 55.6], [59.2, 55.6, 68.0, 67.5],                                                      // building 2 block
    [-2.4, 46.6, 9.98, 53.3], [42.2, 0.05, 47.6, 2.5], [42.2, 48.9, 47.4, 52.9], [60.5, 85.4, 65.3, 91.4],     // ТП basement, 2 × «Камера ЕО», supermarket stair
  ],
  // lift lobbies («Ліфтовий хол» + «Тамбур-шлюз»): walkable rects, doors to the parking (r = hole through the wall,
  // n = outward normal), the stair door (p on a lobby edge, n = into the lobby)
  lobby: {
    B1: { walk: [[66.6, 15.1, 73.1, 18.2]], doors: [{ r: [67.0, 18.1, 68.2, 18.7], n: [0, 1] }], stair: { p: [67.6, 15.1], n: [0, 1] } },
    B2: { walk: [[64.1, 60.7, 67.6, 63.7], [62.1, 59.0, 64.1, 64.9], [59.5, 55.7, 67.7, 57.6], [59.5, 57.6, 65.3, 59.0]],
      doors: [{ r: [59.1, 57.2, 59.6, 58.4], n: [-1, 0], main: true }, { r: [67.6, 56.0, 68.1, 57.2], n: [1, 0] }], stair: { p: [63.5, 55.7], n: [0, 1] } },
    B3: { walk: [[15.0, 14.1, 19.2, 16.0], [17.4, 16.0, 19.3, 18.9], [15.0, 18.9, 19.3, 22.0], [17.5, 22.0, 30.3, 23.9]],
      doors: [{ r: [30.2, 22.3, 30.6, 23.5], n: [1, 0], main: true }, { r: [14.7, 14.4, 15.1, 15.6], n: [-1, 0] }], stair: { p: [21.6, 22.0], n: [0, 1] } },
    B4: { walk: [[16.8, 74.1, 20.4, 77.2], [19.2, 70.3, 21.1, 74.1], [18.2, 68.5, 29.3, 70.3]],
      doors: [{ r: [29.2, 68.8, 29.6, 70.0], n: [1, 0], main: true }], stair: { p: [21.1, 72.9], n: [-1, 0] } },
  },
  // «Додаткові приміщення укриття» (251,21 м²) under building 1 — the way from the parking to building 1's lift hall
  shelter: { building: 'B1', walk: [[66.6, 18.6, 78.2, 22.4], [66.6, 22.4, 85.9, 27.9], [69.2, 27.9, 85.9, 33.3], [66.6, 30.9, 69.2, 33.3]],
    doors: [{ r: [67.0, 33.2, 68.2, 33.7], n: [0, 1], main: true }, { r: [66.0, 31.0, 66.7, 32.2], n: [-1, 0] }] },
  // site coordinate along the ramp axis from which the ramp is walled down to the floor (before it, it passes overhead)
  under: { R2: 15.0 },
};

const H = 3.0, HL = 2.7, SLAB = 0.3, WT = 0.3, DOOR_H = 2.2, GATE_H = 2.6, GATE_W = 6.0, TUNNEL = 2.7;
const EPS = 1e-4;

// ------------------------------------------------------------------ small helpers
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const rc = (x0, z0, x1, z1) => ({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
const hits = (a, b, m = 0) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m;
const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
function subtract(a, b) {   // a minus b → up to four rects
  if (!hits(a, b)) return [a];
  const out = [];
  if (b.x0 > a.x0) out.push(rc(a.x0, a.z0, b.x0, a.z1));
  if (b.x1 < a.x1) out.push(rc(b.x1, a.z0, a.x1, a.z1));
  const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1);
  if (b.z0 > a.z0) out.push(rc(x0, a.z0, x1, b.z0));
  if (b.z1 < a.z1) out.push(rc(x0, b.z1, x1, a.z1));
  return out.filter(r => r.x1 - r.x0 > 0.015 && r.z1 - r.z0 > 0.015);
}
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function cutIntervals(list, a0, a1) {   // remove [a0, a1] from a list of [s, e]
  const out = [];
  for (const [s, e] of list) {
    if (a1 <= s || a0 >= e) { out.push([s, e]); continue; }
    if (a0 > s) out.push([s, a0]);
    if (a1 < e) out.push([a1, e]);
  }
  return out;
}

// cars.js is owned by another task and is not part of the KIT of §4.2: take the helpers from KIT.cars when commons.js
// passes them, otherwise from a lazy import that may fail harmlessly (then the level is built without parked cars).
let CARS = null;
try { import('./cars.js').then(m => { CARS = m; }).catch(() => {}); } catch (e) { /* no dynamic import */ }

// ------------------------------------------------------------------ layout (pure data, world coordinates) — cached
let LAYOUT = null;
function layout(K) {
  if (LAYOUT) return LAYOUT;
  const O = SITE.originSite || [-PARKING.poly[0][0], 0.05 - PARKING.poly[0][1]];
  const S = ([x0, z0, x1, z1]) => rc(x0 - O[0], z0 - O[1], x1 - O[0], z1 - O[1]);
  const P = ([x, z]) => [x - O[0], z - O[1]];
  const poly = PARKING.poly, Y0 = -PARKING.y;
  const POCKET = K.POCKET ?? 1.06, LIFT_W = K.LIFT_W ?? 1.0;

  // --- ramps: generic in axis / top
  const ramps = RAMPS.map(r => {
    const ax = r.axis === 'x', a0 = ax ? r.x0 : r.z0, a1 = ax ? r.x1 : r.z1, l0 = ax ? r.z0 : r.x0, l1 = ax ? r.z1 : r.x1;
    const dir = r.top === 'max' ? -1 : 1, aT = dir > 0 ? a0 : a1, len = a1 - a0;
    const y0 = (r.y0 ?? 0) - PARKING.y, y1 = (r.y1 ?? PARKING.y) - PARKING.y;
    const yAt = s => y0 + (y1 - y0) * Math.min(1, Math.max(0, s / len));
    const sAt = y => len * (y0 - y) / (y0 - y1);
    const W2 = (s, l) => ax ? [aT + dir * s, l] : [l, aT + dir * s];
    const sHole = Math.max(0, sAt(H + SLAB));                      // from here the ramp is below the ceiling slab
    const u = P21.under[r.id]; let sEncl = u == null ? sHole : Math.max(sHole, dir > 0 ? (u - (ax ? O[0] : O[1])) - aT : aT - (u - (ax ? O[0] : O[1])));
    const span = (s0, s1, m = 0) => { const [xa, za] = W2(s0, l0 - m), [xb, zb] = W2(s1, l1 + m); return rc(xa, za, xb, zb); };
    return { id: r.id, ax, dir, aT, len, l0, l1, y0, yAt, sAt, W2, sHole, sEncl, span, hole: span(sHole, len), holeW: span(sHole, len, WT), full: span(0, len, WT),
      h: ax ? [dir, 0] : [0, dir], foot: W2(len, (l0 + l1) / 2), building: r.building, lanes: r.lanes || 2 };
  });

  // --- lifts of all towers (floor-1 core projected down), shafts and landings
  const lifts = [];
  for (const id of B_IDS) {
    const C = coresOf(id, 1)[0]; if (!C || !C.liftDoors) continue;
    C.liftDoors.forEach((d, i) => {
      const n = (C.liftNormals && C.liftNormals[i]) || C.liftNormal || [0, 1];
      const [x, z] = localToWorld(id, d[0], d[1]);   // rotY is 0 for all towers; the level itself is axis-aligned to the world (§8)
      lifts.push({ id, i, x, z, n, hw: POCKET + 0.1 });
    });
  }
  for (const a of lifts) for (const b of lifts) {   // two lifts side by side on one wall share a pier
    if (a === b || a.id !== b.id || a.n[0] !== b.n[0] || a.n[1] !== b.n[1]) continue;
    const dt = Math.abs(a.n[0] ? a.z - b.z : a.x - b.x), dn = Math.abs(a.n[0] ? a.x - b.x : a.z - b.z);
    if (dn < 0.5 && dt < 2 * a.hw + 0.12) a.hw = Math.min(a.hw, (dt - 0.12) / 2);
  }
  const nrect = (L, t0, t1, d0, d1) => L.n[0] ? rc(L.x + L.n[0] * d0, L.z + t0, L.x + L.n[0] * d1, L.z + t1) : rc(L.x + t0, L.z + L.n[1] * d0, L.x + t1, L.z + L.n[1] * d1);
  for (const L of lifts) { L.shaft = nrect(L, -L.hw, L.hw, -2.45, 0); L.landing = nrect(L, -L.hw, L.hw, 0, 0.4); L.nrect = (t0, t1, d0, d1) => nrect(L, t0, t1, d0, d1); L.half = LIFT_W / 2; }

  // --- walkable rooms inside the blocks
  const zones = [];
  for (const id of B_IDS) {
    const src = P21.lobby[id]; if (!src) continue;
    const mine = lifts.filter(L => L.id === id);
    zones.push({ id, kind: 'lobby', walk: [...src.walk.map(S), ...mine.map(L => L.landing)], own: src.walk.length,
      doors: src.doors.map(d => ({ r: S(d.r), n: d.n, main: !!d.main })), stair: src.stair ? { p: P(src.stair.p), n: src.stair.n } : null });
  }
  if (PARKING.shelter && P21.shelter) zones.push({ id: P21.shelter.building, kind: 'shelter', walk: P21.shelter.walk.map(S), own: P21.shelter.walk.length,
    doors: P21.shelter.doors.map(d => ({ r: S(d.r), n: d.n, main: !!d.main })), stair: null });

  // --- bays (numbered west compartment first), aisle side found below
  const wallX = PARKING.wall ? PARKING.wall.from[0] : null;
  const bays = P21.bays.slice(0, PARKING.places).map(([x, z, a, L, w], i) => {
    const [wx, wz] = P([x, z]);
    return { no: i + 1, x: wx, z: wz, a, L, w, x0: wx - (a ? w : L) / 2, x1: wx + (a ? w : L) / 2, z0: wz - (a ? L : w) / 2, z1: wz + (a ? L : w) / 2, d: null };
  });

  // --- fire wall with gates (the gate nearest a ramp foot is the vehicle gate, the others are doors)
  const gates = [], wall = PARKING.wall;
  let wallRect = null;
  if (wall) {
    wallRect = rc(wall.from[0] - WT / 2, wall.from[1], wall.to[0] + WT / 2, wall.to[1]);
    const gs = (wall.gates || []).map(g => ({ z: g[1], car: false }));
    let best = null, bd = 1e9;
    for (const g of gs) for (const r of ramps) { const d = Math.hypot(r.foot[0] - wallX, r.foot[1] - g.z); if (d < bd) { bd = d; best = g; } }
    if (best) best.car = true;
    const blocksW = P21.blocks.map(S);
    for (const g of gs) {
      const w = g.car ? GATE_W : 1.2, reach = g.car ? 3.5 : 1.3;
      const free = z => { const t = rc(wallX - reach, z - w / 2, wallX + reach, z + w / 2); return !blocksW.some(b => hits(t, b)) && (g.car || !bays.some(b => hits(t, b, 0.05))); };
      let z = g.z;
      for (let k = 0; k <= 40 && !free(z); k++) z = g.z + (k % 2 ? 1 : -1) * Math.ceil((k + 1) / 2) * 0.2;   // data: "gate positions approximate"
      gates.push({ x: wallX, z, w, h: g.car ? GATE_H : DOOR_H, car: g.car, r: rc(wallX - WT, z - w / 2, wallX + WT, z + w / 2) });
    }
  }

  // --- solids: blocks (+ the fire wall) minus rooms, shafts, door holes and the ramp corridors
  const cuts = [];
  for (const Z of zones) { cuts.push(...Z.walk); for (const d of Z.doors) cuts.push(d.r); }
  for (const L of lifts) cuts.push(L.shaft);
  for (const r of ramps) cuts.push(r.holeW);
  for (const g of gates) cuts.push(g.r);
  let solids = P21.blocks.map(S); if (wallRect) solids.push(wallRect);
  for (const c of cuts) solids = solids.flatMap(s => subtract(s, c));
  const blocks = P21.blocks.map(S);
  const closed = (x, z, m = 0) => blocks.some(b => inRect(b, x, z, m)) || (wallRect && inRect(wallRect, x, z, m)) || ramps.some(r => inRect(r.holeW, x, z, m));
  const open = (x, z, m = 0.3) => inPoly(poly, x, z) && !closed(x, z, m);

  // --- aisle side of every bay: the end with free floor beyond it (tandem inner bays copy their outer partner)
  const sameSide = (b, x, z) => wallX == null || (b.x < wallX) === (x < wallX);
  const clear = (b, s) => {
    for (const k of [1.2, 2.4]) {
      const x = b.x + (b.a ? 0 : s * (b.L / 2 + k)), z = b.z + (b.a ? s * (b.L / 2 + k) : 0);
      if (!open(x, z) || !sameSide(b, x, z) || bays.some(o => o !== b && inRect(o, x, z, -0.05))) return false;
    }
    return true;
  };
  for (const b of bays) { const p = clear(b, 1), m = clear(b, -1); b.d = p && !m ? 1 : m && !p ? -1 : p && m ? 0 : null; }
  for (const b of bays) if (b.d === 0) {   // free on both ends: face the wider gap
    let s = 1; for (const k of [3.5, 5, 6.5]) { const f = t => open(b.x + (b.a ? 0 : t * (b.L / 2 + k)), b.z + (b.a ? t * (b.L / 2 + k) : 0)); if (f(1) !== f(-1)) { s = f(1) ? 1 : -1; break; } }
    b.d = s;
  }
  for (const b of bays) if (b.d == null) {
    const o = bays.find(o => o !== b && o.a === b.a && o.d && (b.a ? Math.abs(o.x - b.x) < 1 && Math.abs(o.z - b.z) < (o.L + b.L) / 2 + 0.6 : Math.abs(o.z - b.z) < 1 && Math.abs(o.x - b.x) < (o.L + b.L) / 2 + 0.6));
    b.d = o ? (b.a ? Math.sign(o.z - b.z) : Math.sign(o.x - b.x)) || 1 : 1; b.inner = !!o;
  }
  for (const b of bays) b.dv = b.a ? [0, b.d] : [b.d, 0];

  // --- columns as drawn, only those standing free on the parking floor
  const cols = [];
  for (const [x, z, w, d] of P21.cols) {
    const [wx, wz] = P([x, z]);
    if (!inPoly(poly, wx, wz) || closed(wx, wz, 0.1) || zones.some(Z => Z.walk.some(r => inRect(r, wx, wz, 0.2)))) continue;
    if (wallRect && inRect(wallRect, wx, wz, 0.3)) continue;
    if (ramps.some(r => inRect(r.full, wx, wz, 0.1) && r.yAt(r.dir > 0 ? (r.ax ? wx : wz) - r.aT : r.aT - (r.ax ? wx : wz)) < H + 0.6)) continue;
    if (bays.some(b => inRect(b, wx, wz, -0.45))) continue;
    cols.push({ x: wx, z: wz, w: Math.max(0.3, w), d: Math.max(0.3, d) });
  }

  // --- a free standing point in front of every tower's way in
  const spawns = {};
  for (const id of B_IDS) {
    const Z = zones.find(z => z.id === id && z.kind === 'shelter') || zones.find(z => z.id === id);
    const D = Z && (Z.doors.find(d => d.main) || Z.doors[0]);
    if (!D) { const c = BUILDINGS[id].origin; spawns[id] = { x: c[0], z: c[1], yaw: 0, door: null }; continue; }
    const cx = (D.r.x0 + D.r.x1) / 2, cz = (D.r.z0 + D.r.z1) / 2;
    let sp = null;
    for (let k = 2.4; k < 7 && !sp; k += 0.4) {
      const x = cx + D.n[0] * k, z = cz + D.n[1] * k;
      if (open(x, z, 0.5) && !bays.some(b => inRect(b, x, z, 0.5)) && !cols.some(c => Math.hypot(c.x - x, c.z - z) < 0.9)) sp = { x, z };
    }
    sp = sp || { x: cx + D.n[0] * 2.4, z: cz + D.n[1] * 2.4 };
    spawns[id] = { ...sp, yaw: Math.atan2(D.n[0], D.n[1]), door: D };   // looks at the door (walk.js: yaw = atan2(−dx, −dz))
  }
  return (LAYOUT = { O, poly, Y0, ramps, lifts, zones, bays, gates, wallRect, wallX, solids, blocks, cols, spawns, open, closed });
}

// ------------------------------------------------------------------ builder
export function buildTowerParking(KIT, bId) {
  const T = KIT.THREE || THREE;
  const Lay = layout(KIT);
  const { poly, Y0, ramps, lifts, zones, bays, gates, solids, cols, spawns, open } = Lay;
  const ctx = KIT.makeCtx(bId, -1, H);
  const rotY = BUILDINGS[bId].rotY || 0;
  const W = new T.Group(); W.name = 'vrc-parking-world'; W.rotation.y = -rotY;
  { const [ox, oz] = worldToLocal(bId, 0, 0); W.position.set(ox, 0, oz); } ctx.root.add(W);
  const B = new KIT.Batch(), C = new KIT.Colliders(16), signB = new KIT.Batch(), topB = new KIT.Batch();   // topB: everything overhead (userData.ceiling)
  const wctx = { ...ctx, root: W, B, C, signB };
  const ownMat = ctx.ownMat || [], ownGeo = [], ownTex = ctx.ownTex || (ctx.ownTex = []);
  const mat4 = KIT.mat4, boxGeo = KIT.boxGeo;
  const FACE = KIT.FACE ?? 0.02, WALL_T = KIT.WALL_T ?? 0.14, LIFT_H = KIT.LIFT_H ?? 2.2;

  // shared materials by key, with a plain fallback so a missing key never breaks the level
  const FB = { epoxy: 0x6f7377, ceilingP: 0x9d9b96, concreteLight: 0xd8d4cc, concrete: 0xa9a6a0, paint: 0xf2efe6, paintYellow: 0xe0b12a, paintGreen: 0x2d6a4a,
    hazard: 0x1b1b1b, pipeRed: 0x7c2620, steel: 0xa6a8aa, white: 0xf4f2ee, stone: 0xcfc8bb, marble: 0xe9e4da, glass: 0xc9d6d4, bronze: 0x8a6a3a, bronzeDark: 0x3a2c20,
    blackGlass: 0x0b0a09, walnutDoor: 0x5a4030 };
  const fbCache = {};
  const M = key => {
    try { const m = KIT.M(key); if (m) return m; } catch (e) { /* unknown key */ }
    if (!fbCache[key]) {
      const m = key === 'led' || key === 'ledCool' ? new T.MeshBasicMaterial({ color: new T.Color(2.3, 2.3, 2.2) })
        : new T.MeshStandardMaterial({ color: FB[key] ?? 0x999999, roughness: 0.8, transparent: key === 'glass', opacity: key === 'glass' ? 0.18 : 1 });
      fbCache[key] = m; ownMat.push(m);
    }
    return fbCache[key];
  };
  const box = (mat, x0, x1, y0, y1, z0, z1) => B.box(M(mat), x0, x1, y0, y1, z0, z1);
  const solidBox = (mat, x0, x1, y0, y1, z0, z1) => { box(mat, x0, x1, y0, y1, z0, z1); C.box(x0, x1, y0, y1, z0, z1); };
  const walkGeo = g => {
    if (C.geoFloor) return C.geoFloor(g);
    const m = new T.Mesh(g, M('hidden')); m.visible = false; m.userData.floor = true; m.userData.collider = true; m.name = 'vrc-floor'; W.add(m);
  };

  // ---------------------------------------------------------------- slab, ceiling, perimeter
  const flat = (holes, up) => {
    const sh = new T.Shape(poly.map(([x, z]) => new T.Vector2(x, z)));
    for (const h of holes) sh.holes.push(new T.Path([[h.x0, h.z0], [h.x1, h.z0], [h.x1, h.z1], [h.x0, h.z1]].map(([x, z]) => new T.Vector2(x, z))));
    const g = new T.ShapeGeometry(sh); g.rotateX(Math.PI / 2);          // (x, z, 0) → (x, 0, z), facing down
    if (up) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    return g;
  };
  B.add(M('epoxy'), flat([], true));
  C.rect(PARKING.x0, PARKING.x1, PARKING.z0, PARKING.z1, 0);
  {
    const g = flat(ramps.map(r => r.hole), false); g.translate(0, H, 0); ownGeo.push(g);
    const mesh = new T.Mesh(g, M('ceilingP')); mesh.name = 'vrc-parking-ceiling'; mesh.userData.ceiling = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); W.add(mesh);
  }
  {
    let area = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    const sg = area > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], len = Math.hypot(bx - ax, bz - az); if (len < 0.05) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len, nx = sg * tz, nz = -sg * tx;    // outward
      if (Math.abs(tx) < 0.02 || Math.abs(tz) < 0.02) {
        const r = rc(ax, az, bx + nx * WT, bz + nz * WT);
        solidBox('concreteLight', r.x0, r.x1, 0, H, r.z0, r.z1);
        box('paintGreen', Math.abs(nx) > 0.5 ? ax - nx * 0.012 : r.x0, Math.abs(nx) > 0.5 ? ax : r.x1, 0, 1.1, Math.abs(nz) > 0.5 ? az - nz * 0.012 : r.z0, Math.abs(nz) > 0.5 ? az : r.z1);
      } else {
        const g = new T.BoxGeometry(len + WT, H, WT); g.translate(0, H / 2, 0);
        B.add(M('concreteLight'), g, mat4((ax + bx) / 2 + nx * WT / 2, 0, (az + bz) / 2 + nz * WT / 2, Math.atan2(-tz, tx)));
        const n = Math.ceil(len / 0.5);
        for (let k = 0; k < n; k++) { const x = ax + (bx - ax) * (k + 0.5) / n + nx * 0.3, z = az + (bz - az) * (k + 0.5) / n + nz * 0.3; C.box(x - 0.35, x + 0.35, 0, H, z - 0.35, z + 0.35); }
      }
    }
  }

  // ---------------------------------------------------------------- closed blocks (technical rooms, cores, fire wall)
  for (const s of solids) solidBox('concreteLight', s.x0, s.x1, 0, H, s.z0, s.z1);
  for (const g of gates) {   // lintel, red fire frame, leaves folded open
    box('concreteLight', g.r.x0 + WT / 2, g.r.x1 - WT / 2, g.h, H, g.r.z0, g.r.z1);
    for (const z of [g.r.z0, g.r.z1]) box('pipeRed', g.x - WT / 2 - 0.02, g.x + WT / 2 + 0.02, 0, g.h, z - 0.06, z + 0.06);
    box('pipeRed', g.x - WT / 2 - 0.02, g.x + WT / 2 + 0.02, g.h, g.h + 0.12, g.r.z0 - 0.06, g.r.z1 + 0.06);
    const lw = g.car ? g.w / 2 : g.w;
    for (const z of g.car ? [g.r.z0, g.r.z1] : [g.r.z0]) solidBox('steel', g.x + WT / 2, g.x + WT / 2 + lw, 0.05, g.h - 0.05, z - 0.03, z + 0.03);
  }
  if (Lay.wallRect) {   // red band: this is the fire wall between the two compartments
    let iv = [[Lay.wallRect.z0, Lay.wallRect.z1]]; for (const g of gates) iv = cutIntervals(iv, g.r.z0 - 0.06, g.r.z1 + 0.06);
    for (const s of [-1, 1]) for (const [a, b] of iv) { const x = Lay.wallX + s * WT / 2; box('pipeRed', Math.min(x, x + s * 0.006), Math.max(x, x + s * 0.006), 1.1, 1.3, a, b); }
  }

  // ---------------------------------------------------------------- columns
  {
    const cm = [], bm = [], hm = [];
    for (const c of cols) {
      cm.push(mat4(c.x, H / 2, c.z, 0, c.w, H, c.d)); bm.push(mat4(c.x, 0.45, c.z, 0, c.w + 0.02, 0.9, c.d + 0.02)); hm.push(mat4(c.x, 0.7, c.z, 0, c.w + 0.025, 0.12, c.d + 0.025));
      C.box(c.x - c.w / 2, c.x + c.w / 2, 0, H, c.z - c.d / 2, c.z + c.d / 2);
    }
    const unit = ctx.geo('pkUnit', () => new T.BoxGeometry(1, 1, 1));
    KIT.instanced(W, unit, M('concreteLight'), cm); KIT.instanced(W, unit, M('paintYellow'), bm); KIT.instanced(W, unit, M('hazard'), hm);
  }

  // ---------------------------------------------------------------- bays: lines, numbers, parked cars
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const tex = c => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; ownTex.push(t); return t; };
  const SANS = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  {
    const cv = canvas(1024, 512), g = cv.getContext('2d');
    g.clearRect(0, 0, 1024, 512); g.fillStyle = '#f4f1ea'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 30px ${SANS}`;
    bays.forEach((b, i) => g.fillText(String(b.no).padStart(3, '0'), (i % 16) * 64 + 32, ((i / 16) | 0) * 32 + 17));
    const nMat = new T.MeshStandardMaterial({ map: tex(cv), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    ownMat.push(nMat);
    const nb = new KIT.Batch();
    const seen = new Set();
    const line = (x0, z0, x1, z1) => {
      const k = [x0, z0, x1, z1].map(v => Math.round(v * 5)).join(','); if (seen.has(k)) return; seen.add(k);
      box('paint', Math.min(x0, x1) - 0.05, Math.max(x0, x1) + 0.05, 0.001, 0.004, Math.min(z0, z1) - 0.05, Math.max(z0, z1) + 0.05);
    };
    for (const b of bays) {
      if (b.a) { line(b.x0, b.z0, b.x0, b.z1); line(b.x1, b.z0, b.x1, b.z1); const zb = b.d > 0 ? b.z0 : b.z1; if (!b.inner) line(b.x0, zb, b.x1, zb); }
      else { line(b.x0, b.z0, b.x1, b.z0); line(b.x0, b.z1, b.x1, b.z1); const xb = b.d > 0 ? b.x0 : b.x1; if (!b.inner) line(xb, b.z0, xb, b.z1); }
      const pg = new T.PlaneGeometry(0.62, 0.31); pg.rotateX(-Math.PI / 2);
      const i = b.no - 1, uv = pg.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, ((i % 16) + uv.getX(k)) / 16, 1 - (((i / 16) | 0) + 1 - uv.getY(k)) / 16);
      nb.add(nMat, pg, mat4(b.x + b.dv[0] * (b.L / 2 - 0.42), 0.006, b.z + b.dv[1] * (b.L / 2 - 0.42), Math.atan2(b.dv[0], b.dv[1])));
    }
    nb.flush(W);
  }
  // zebra from every way in to the open floor
  for (const Z of zones) for (const D of Z.doors) {
    const cx = (D.r.x0 + D.r.x1) / 2, cz = (D.r.z0 + D.r.z1) / 2;
    if (!open(cx + D.n[0] * 1.5, cz + D.n[1] * 1.5, 0.2) || zones.some(z => z.walk.some(r => inRect(r, cx + D.n[0] * 1.5, cz + D.n[1] * 1.5)))) continue;
    for (let k = 0; k < 5; k++) { const d = 0.7 + k * 0.6, x = cx + D.n[0] * d, z = cz + D.n[1] * d; if (!open(x, z, 0.1) || bays.some(b => inRect(b, x, z))) break; box('paint', x - (D.n[0] ? 0.15 : 0.7), x + (D.n[0] ? 0.15 : 0.7), 0.001, 0.004, z - (D.n[1] ? 0.15 : 0.7), z + (D.n[1] ? 0.15 : 0.7)); }
  }
  {
    const cars = KIT.cars || (KIT.createCarInstances ? KIT : null) || CARS;
    const list = [];
    if (cars && cars.pickCar && cars.carSpec) {
      const r = (cars.carRng || rng)(20260930);   // the same parked cars whichever tower's view is built
      for (const b of bays) {
        if (r() > 0.7) continue;
        const near = Object.values(spawns).some(s => Math.hypot(s.x - b.x, s.z - b.z) < 3.2);
        let pick = null, S = null;
        for (let k = 0; k < 5 && !pick; k++) { const p = cars.pickCar(r), s = cars.carSpec(p.kind); if (((s.zF != null && s.zR != null) ? s.zF - s.zR : (s.L ?? 4.9)) <= b.L + 0.35) { pick = p; S = s; } }
        if (!pick || near) continue;
        const nose = r() < 0.55, zF = S.zF ?? (S.L ?? 4.8) / 2, zR = S.zR ?? -(S.L ?? 4.8) / 2;   // zR < 0 < zF along the car's forward axis
        const yaw = Math.atan2(b.dv[0], b.dv[1]) + (nose ? 0 : Math.PI) + (r() - 0.5) * 0.03;
        const off = -((zF + zR) / 2) * (nose ? 1 : -1);   // centre the body, not the origin, in the bay
        list.push({ x: b.x + b.dv[0] * off + (b.a ? (r() - 0.5) * 0.12 : 0), y: 0, z: b.z + b.dv[1] * off + (b.a ? 0 : (r() - 0.5) * 0.12), yaw, bay: b.no, ...pick });
      }
      try { if (cars.createCarInstances) { ctx.carInstances = cars.createCarInstances(list); ctx.carInstances.group.name = 'vrc-parked-cars'; W.add(ctx.carInstances.group); } } catch (e) { console.warn('[parking] cars', e); ctx.carInstances = null; }
    }
    const py = floorY(bId, -1);
    ctx.parkedCars = list.map(c => ({ ...c, y: py }));
  }

  // ---------------------------------------------------------------- signs (Ukrainian wayfinding, one atlas)
  const LABELS = ['Ліфт', 'Вихід', 'Укриття', 'Сходи', 'Виїзд', 'Паркінг −1', 'Відсік 1', 'Відсік 2', ...B_IDS.map(id => 'Будинок ' + BUILDINGS[id].no)];
  const GREEN = new Set(['Вихід', 'Укриття', 'Сходи', 'Виїзд']);
  let sMat = null;
  {
    const cv = canvas(1024, 512), g = cv.getContext('2d');
    LABELS.forEach((t, i) => {
      const x = (i % 2) * 512, y = ((i / 2) | 0) * 64;
      g.fillStyle = GREEN.has(t) ? '#12703f' : '#15171a'; g.fillRect(x, y, 512, 64);
      g.fillStyle = GREEN.has(t) ? '#12703f' : '#e0b12a'; g.fillRect(x, y + 58, 512, 6);
      g.fillStyle = '#f6f3ec'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 40px ${SANS}`; g.fillText(t.toUpperCase(), x + 256, y + 31);
    });
    sMat = new T.MeshBasicMaterial({ map: tex(cv), color: new T.Color(1.25, 1.25, 1.25) }); ownMat.push(sMat);
  }
  const sb = new KIT.Batch();
  // a plaque: centre (x, y, z), facing normal n (horizontal), width w
  const sign = (label, x, y, z, n, w = 1.6) => {
    const i = LABELS.indexOf(label); if (i < 0) return;
    const h = w / 8, g = new T.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, ((i % 2) + uv.getX(k)) / 2, 1 - (((i / 2) | 0) + 1 - uv.getY(k)) / 8);
    const yaw = Math.atan2(n[0], n[1]);
    sb.add(sMat, g, mat4(x + n[0] * 0.026, y, z + n[1] * 0.026, yaw));
    const bg = new T.BoxGeometry(w + 0.06, h + 0.06, 0.04); B.add(M('hazard'), bg, mat4(x, y, z, yaw));
  };
  const hang = (label, x, z, n, w = 1.8, y = H - 0.45) => {   // double-sided, hung from the ceiling
    sign(label, x, y, z, n, w); sign(label, x, y, z, [-n[0], -n[1]], w);
    for (const s of [-1, 1]) box('steel', x + n[1] * s * w * 0.4 - 0.012, x + n[1] * s * w * 0.4 + 0.012, y + w / 16, H, z + n[0] * s * w * 0.4 - 0.012, z + n[0] * s * w * 0.4 + 0.012);
  };

  // ---------------------------------------------------------------- lobbies, shelter premises, lifts, stair doors
  const edgesOf = Z => {   // boundary pieces of the union of Z.walk, with door and lift openings removed
    const out = [];
    Z.walk.forEach((r, ri) => {
      for (const [axis, c, a0, a1, side] of [['x', r.z0, r.x0, r.x1, 1], ['x', r.z1, r.x0, r.x1, -1], ['z', r.x0, r.z0, r.z1, 1], ['z', r.x1, r.z0, r.z1, -1]]) {
        let iv = [[a0, a1]];
        Z.walk.forEach((o, oi) => {   // covered by a neighbouring rect
          if (oi === ri) return;
          const [o0, o1, p0, p1] = axis === 'x' ? [o.z0, o.z1, o.x0, o.x1] : [o.x0, o.x1, o.z0, o.z1];
          if (c > o0 - 0.03 && c < o1 + 0.03 && !(Math.abs(c - (side > 0 ? o0 : o1)) < 0.03)) iv = cutIntervals(iv, p0, p1);
          else if (Math.abs(c - (side > 0 ? o1 : o0)) < 0.03) iv = cutIntervals(iv, p0, p1);
        });
        const lintels = [];
        for (const D of Z.doors) {
          const [d0, d1, p0, p1] = axis === 'x' ? [D.r.z0, D.r.z1, D.r.x0, D.r.x1] : [D.r.x0, D.r.x1, D.r.z0, D.r.z1];
          if ((axis === 'x') === (D.n[1] !== 0) && c > d0 - 0.25 && c < d1 + 0.25) { iv = cutIntervals(iv, p0, p1); lintels.push([p0, p1, DOOR_H]); }
        }
        for (const L of lifts) if (L.id === Z.id && (axis === 'x') === (L.n[1] !== 0) && Math.abs(c - (axis === 'x' ? L.z : L.x)) < 0.03) { const t = axis === 'x' ? L.x : L.z; iv = cutIntervals(iv, t - L.hw - 0.01, t + L.hw + 0.01); }
        for (const [s, e] of iv) if (e - s > 0.03) out.push({ axis, c, a0: s, a1: e, side });
        for (const [s, e, h] of lintels) if (s >= a0 - 0.01 && e <= a1 + 0.01) out.push({ axis, c, a0: s, a1: e, side, y0: h });
      }
    });
    return out;
  };
  const liner = (mat, e, y0, y1, t = 0.015) => e.axis === 'x' ? box(mat, e.a0, e.a1, y0, y1, e.c, e.c + e.side * t) : box(mat, e.c, e.c + e.side * t, y0, y1, e.a0, e.a1);
  const leds = [];
  for (const Z of zones) {
    const lobby = Z.kind === 'lobby', no = BUILDINGS[Z.id].no;
    if (lobby) {
      for (const r of Z.walk) { box('stone', r.x0, r.x1, 0, 0.02, r.z0, r.z1); C.rect(r.x0, r.x1, r.z0, r.z1, 0.02); topB.box(M('white'), r.x0, r.x1, HL, HL + 0.04, r.z0, r.z1); }
      Z.walk.slice(0, Z.own).forEach(r => { const nx = Math.max(1, Math.round((r.x1 - r.x0) / 2.6)), nz = Math.max(1, Math.round((r.z1 - r.z0) / 2.6)); for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) leds.push([r.x0 + (r.x1 - r.x0) * (i + 0.5) / nx, r.z0 + (r.z1 - r.z0) * (j + 0.5) / nz]); });
      for (const e of edgesOf(Z)) { liner('marble', e, e.y0 ?? 0, HL); if (e.y0 == null) liner('bronzeDark', e, 0, 0.1, 0.022); }
    } else {
      for (const e of edgesOf(Z)) if (e.y0 == null) { liner('paintGreen', e, 0, 1.1, 0.012); liner('paint', e, 1.1, 1.16, 0.013); }
      // benches along the longest wall + plaques: this room is the marked shelter
      const big = Z.walk.reduce((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) > (a.x1 - a.x0) * (a.z1 - a.z0) ? b : a);
      for (let x = big.x0 + 1.2; x + 2 < big.x1 - 0.6; x += 2.6) { solidBox('walnutDoor', x, x + 2, 0.4, 0.46, big.z0 + 0.12, big.z0 + 0.52); box('steel', x + 0.1, x + 0.16, 0, 0.4, big.z0 + 0.15, big.z0 + 0.49); box('steel', x + 1.84, x + 1.9, 0, 0.4, big.z0 + 0.15, big.z0 + 0.49); }
      sign('Укриття', (big.x0 + big.x1) / 2, 2.2, big.z0 + 0.03, [0, 1], 2.4);
    }
    // doors: bronze frame, glass leaves folded open, lintel, plaques
    for (const D of Z.doors) {
      const r = D.r, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, alongX = D.n[1] !== 0;
      box('concreteLight', r.x0, r.x1, DOOR_H, H, r.z0, r.z1);
      const w = alongX ? r.x1 - r.x0 : r.z1 - r.z0, t0 = alongX ? r.x0 : r.z0, t1 = alongX ? r.x1 : r.z1;
      const ox = alongX ? cz + D.n[1] * ((r.z1 - r.z0) / 2) : cx + D.n[0] * ((r.x1 - r.x0) / 2);   // outer face coordinate
      for (const t of [t0, t1]) alongX ? box('bronzeDark', t - 0.04, t + 0.04, 0, DOOR_H, r.z0, r.z1) : box('bronzeDark', r.x0, r.x1, 0, DOOR_H, t - 0.04, t + 0.04);
      for (const [t, s] of [[t0, 1], [t1, -1]]) {   // each leaf swung 90° outwards
        const a = ox, b = ox + (alongX ? D.n[1] : D.n[0]) * (w / 2 - 0.05);
        alongX ? box('glass', t + s * 0.05, t + s * 0.062, 0.03, DOOR_H - 0.05, Math.min(a, b), Math.max(a, b)) : box('glass', Math.min(a, b), Math.max(a, b), 0.03, DOOR_H - 0.05, t + s * 0.05, t + s * 0.062);
        alongX ? C.box(t + s * 0.02, t + s * 0.09, 0, DOOR_H, Math.min(a, b), Math.max(a, b)) : C.box(Math.min(a, b), Math.max(a, b), 0, DOOR_H, t + s * 0.02, t + s * 0.09);
      }
      const sx = alongX ? cx : ox, sz = alongX ? ox : cz;
      const outside = !zones.some(z => z.walk.some(q => inRect(q, cx + D.n[0] * 1.0, cz + D.n[1] * 1.0)));
      if (lobby) { sign('Будинок ' + no, sx, DOOR_H + 0.42, sz, D.n, 1.5); sign('Ліфт', sx, DOOR_H + 0.2, sz, D.n, 1.1); }
      else if (outside) { sign('Укриття', sx, DOOR_H + 0.42, sz, D.n, 1.7); sign('Будинок ' + no, sx, DOOR_H + 0.18, sz, D.n, 1.3); }
      if (outside && D.main) hang(lobby ? 'Будинок ' + no : 'Укриття', cx + D.n[0] * 3.2, cz + D.n[1] * 3.2, [D.n[1], D.n[0]]);
      // the way back out, seen from inside
      const ix = alongX ? cx : ox - D.n[0] * (r.x1 - r.x0), iz = alongX ? ox - D.n[1] * (r.z1 - r.z0) : cz;
      if (lobby || outside) sign(lobby && outside ? 'Паркінг −1' : 'Вихід', ix, DOOR_H + 0.25, iz, [-D.n[0], -D.n[1]], 1.2);
    }
    // stair door (closed leaf) with «ВИХІД» + stair pictogram
    if (Z.stair) {
      const { p, n } = Z.stair, yaw = Math.atan2(n[0], n[1]);
      const leaf = new T.Mesh(ctx.geo('pkStairLeaf', () => new T.BoxGeometry(0.95, DOOR_H, 0.05)), M('walnutDoor'));
      leaf.position.set(p[0] + n[0] * 0.045, DOOR_H / 2, p[1] + n[1] * 0.045); leaf.rotation.y = yaw; leaf.userData.solid = true; leaf.name = 'vrc-stair-door-' + Z.id; W.add(leaf);
      for (const s of [-1, 1]) B.add(M('bronzeDark'), new T.BoxGeometry(0.06, DOOR_H + 0.06, 0.07), mat4(p[0] + n[0] * 0.04 + n[1] * s * 0.505, (DOOR_H + 0.06) / 2, p[1] + n[1] * 0.04 + n[0] * s * 0.505, yaw));
      B.add(M('steel'), new T.BoxGeometry(0.03, 0.03, 0.14), mat4(p[0] + n[0] * 0.1 + n[1] * 0.36, 1.02, p[1] + n[1] * 0.1 - n[0] * 0.36, yaw));
      sign('Вихід', p[0] + n[0] * 0.02, DOOR_H + 0.26, p[1] + n[1] * 0.02, n, 1.0);
      sign('Сходи', p[0] + n[0] * 0.02, DOOR_H + 0.06, p[1] + n[1] * 0.02, n, 0.8);
      try { KIT.signPlane(wctx, 0, p[0] + n[0] * 0.075, 1.6, p[1] + n[1] * 0.075, yaw, 0.18, 0.18); } catch (e) { /* optional pictogram */ }
    }
  }
  if (leds.length) KIT.instanced(W, ctx.geo('pkLed', () => new T.BoxGeometry(0.5, 0.02, 0.5)), M('led'), leds.map(([x, z]) => mat4(x, HL - 0.008, z)));

  // lift fronts: wall at the door plane with the opening, plaque above; the cars are KIT.Lift objects
  const byB = {};
  for (const L of lifts) {
    for (const [t0, t1, y0, y1] of [[-L.hw, -L.half, 0, H], [L.half, L.hw, 0, H], [-L.half, L.half, LIFT_H, H]]) {
      if (t1 - t0 < 0.01) continue;
      const r = L.nrect(t0, t1, -WALL_T, FACE);
      if (y0 === 0) solidBox('marble', r.x0, r.x1, y0, y1, r.z0, r.z1); else box('marble', r.x0, r.x1, y0, y1, r.z0, r.z1);
    }
    sign('Ліфт', L.x + L.n[0] * (FACE + 0.02), LIFT_H + 0.22, L.z + L.n[1] * (FACE + 0.02), L.n, 0.9);
    (byB[L.id] ||= []).push(L);
    try {
      const Lf = new KIT.Lift(L.id, 0, L.i, -1);
      if (L.id !== bId && Lf.group) { const [wx, wz] = localToWorld(L.id, 0, 0), [lx, lz] = worldToLocal(bId, wx, wz); Lf.group.position.set(lx, 0, lz); Lf.group.rotation.y = (BUILDINGS[L.id].rotY || 0) - rotY; }
      ctx.lifts.push(Lf);
    } catch (e) { console.warn('[parking] lift', L.id, L.i, e); solidBox('steel', ...(r => [r.x0, r.x1, 0, LIFT_H, r.z0, r.z1])(L.nrect(-L.half, L.half, -0.1, 0))); }
  }
  for (const id of Object.keys(byB)) {   // one call plate per tower, beside the first lift, plus the tower's name
    const L = byB[id][0], side = byB[id].length > 1 && byB[id][1].n[0] === L.n[0] && byB[id][1].n[1] === L.n[1] ? Math.sign((L.n[0] ? byB[id][1].z - L.z : byB[id][1].x - L.x)) || 1 : 1;
    const t = side * Math.min(L.hw - 0.12, L.half + 0.32), px = L.x + (L.n[0] ? 0 : t) + L.n[0] * (FACE + 0.02), pz = L.z + (L.n[0] ? t : 0) + L.n[1] * (FACE + 0.02);
    try { KIT.callPlate(wctx, px, 1.12, pz, Math.atan2(L.n[0], L.n[1]), { type: 'liftCall', building: id, stair: 1 }); } catch (e) { console.warn('[parking] call plate', e); }
    sign('Будинок ' + BUILDINGS[id].no, L.x + L.n[0] * (FACE + 0.02), LIFT_H + 0.48, L.z + L.n[1] * (FACE + 0.02), L.n, 1.3);
  }

  // ---------------------------------------------------------------- ramps
  for (const r of ramps) {
    const { len, l0, l1, y0, yAt, W2, h } = r, wd = l1 - l0, lm = (l0 + l1) / 2;
    const ang = Math.atan2(y0, len), L3 = Math.hypot(len, y0), cs = Math.cos(ang), sn = Math.sin(ang);
    const eS = new T.Vector3(h[0] * cs, -sn, h[1] * cs), eN = new T.Vector3(h[0] * sn, cs, h[1] * sn), eW = new T.Vector3().crossVectors(eN, eS);
    const basis = (s, y) => { const [x, z] = W2(s, lm); return new T.Matrix4().makeBasis(eW, eN, eS).setPosition(x, y, z); };
    // slab + walkable / drivable surface
    B.add(M('concrete'), new T.BoxGeometry(wd, SLAB, L3), basis(len / 2, y0 / 2 - SLAB / 2 / cs));
    { const g = new T.PlaneGeometry(wd - 0.04, L3); g.rotateX(-Math.PI / 2); g.applyMatrix4(basis(len / 2, y0 / 2 + 0.004)); walkGeo(g); }
    // tunnel roof: parallel to the ramp down to the parking ceiling, then the ceiling itself
    const sR = Math.min(len, Math.max(0, r.sAt(H - TUNNEL)));
    { const Lr = sR / cs; topB.add(M('ceilingP'), new T.BoxGeometry(wd + 2 * WT, SLAB, Lr), basis(sR / 2, yAt(sR / 2) + TUNNEL + SLAB / 2 / cs)); }
    if (len - sR > 0.02) { const a = r.span(sR, len, WT); topB.box(M('ceilingP'), a.x0, a.x1, H, H + SLAB, a.z0, a.z1); }
    // side walls: from the floor where the ramp is walled in, from the slab underside where it passes overhead
    const prof = new T.Shape();
    const yb = s => s >= r.sEncl - EPS ? 0 : yAt(s) - SLAB;
    prof.moveTo(0, yb(0));
    if (r.sEncl > EPS) { prof.lineTo(r.sEncl, yAt(r.sEncl) - SLAB); prof.lineTo(r.sEncl, 0); }
    prof.lineTo(len, 0); prof.lineTo(len, H + SLAB); prof.lineTo(sR, H + SLAB); prof.lineTo(0, y0 + TUNNEL + SLAB);
    const X = new T.Vector3(h[0], 0, h[1]), Yv = new T.Vector3(0, 1, 0), Zv = new T.Vector3().crossVectors(X, Yv);
    const zl = r.ax ? Zv.z : Zv.x;   // +1: extrusion runs toward +lateral
    for (const c of [l0 - WT, l1]) {
      const g = new T.ExtrudeGeometry(prof, { depth: WT, bevelEnabled: false });
      const [x, z] = W2(0, zl > 0 ? c : c + WT); g.applyMatrix4(new T.Matrix4().makeBasis(X, Yv, Zv).setPosition(x, 0, z)); g.deleteAttribute('uv'); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      B.add(M('concreteLight'), g);
      const n = Math.ceil(len / 1.0);
      for (let k = 0; k < n; k++) { const s0 = len * k / n, s1 = len * (k + 1) / n, a = rc(...W2(s0, c), ...W2(s1, c + WT)); C.box(a.x0, a.x1, Math.max(0, yb(s1)), Math.max(H + SLAB, yAt(s0) + TUNNEL), a.z0, a.z1); }
    }
    if (r.sEncl > 0.3 && yAt(r.sEncl) - SLAB > 0.05) { const a = r.span(r.sEncl - 0.2, r.sEncl); solidBox('concreteLight', a.x0, a.x1, 0, yAt(r.sEncl) - SLAB, a.z0, a.z1); }
    // rumble strips, centre line, tunnel lights
    for (let k = 0; k < 14; k++) { const s = (k + 0.5) / 14 * len, a = rc(...W2(s - 0.08, l0 + 0.5), ...W2(s + 0.08, l1 - 0.5)); box('paintYellow', a.x0, a.x1, yAt(s) + 0.008, yAt(s) + 0.022, a.z0, a.z1); }
    for (let s = 1.5; s < len - 0.5; s += 3.2) { const a = rc(...W2(s - 0.05, lm - 0.75), ...W2(s + 0.05, lm + 0.75)), y = Math.max(H, yAt(s) + TUNNEL); box('ledCool', a.x0, a.x1, y - 0.05, y - 0.005, a.z0, a.z1); }
    // portal at ground level: frame, hazard band, name
    {
      const yT = y0 + TUNNEL;
      for (const c of [l0 - WT, l1]) { const a = rc(...W2(-0.12, c - 0.04), ...W2(0.25, c + WT + 0.04)); box('hazard', a.x0, a.x1, y0, yT + SLAB + 0.1, a.z0, a.z1); const s2 = rc(...W2(-0.13, c + 0.02), ...W2(-0.1, c + WT - 0.02)); box('paintYellow', s2.x0, s2.x1, y0 + 0.2, y0 + 1.4, s2.z0, s2.z1); }
      const a = rc(...W2(-0.12, l0 - WT - 0.04), ...W2(0.25, l1 + WT + 0.04)); box('hazard', a.x0, a.x1, yT, yT + SLAB + 0.1, a.z0, a.z1);
      const [px, pz] = W2(-0.14, lm); sign('Паркінг −1', px, yT + 0.2, pz, [-h[0], -h[1]], 2.4);
      const [qx, qz] = W2(0.27, lm); sign('Виїзд', qx, yT - 0.25, qz, h, 2.0);
    }
    // foot: «ВИЇЗД» over the opening, raised boom at the side
    { const [fx, fz] = W2(len + 0.02, lm); sign('Виїзд', fx, H - 0.2, fz, h, 2.2); }
    { const p = W2(len - 0.25, l1 - 0.45); box('white', p[0] - 0.14, p[0] + 0.14, 0, 1.05, p[1] - 0.14, p[1] + 0.14); for (let k = 0; k < 5; k++) box(k % 2 ? 'white' : 'pipeRed', p[0] - 0.04, p[0] + 0.04, 1.05 + k * 0.33, 1.05 + (k + 1) * 0.33, p[1] - 0.04, p[1] + 0.04); C.box(p[0] - 0.14, p[0] + 0.14, 0, 1.05, p[1] - 0.14, p[1] + 0.14); }
  }

  // ---------------------------------------------------------------- lighting (instanced battens + additive pools), pipes
  const bat = [];
  {
    const inRoom = (x, z) => zones.some(Z => Z.kind === 'lobby' && Z.walk.some(r => inRect(r, x, z, 0.3)));
    for (let x = PARKING.x0 + 3; x < PARKING.x1 - 1; x += 6) for (let z = PARKING.z0 + 2.75; z < PARKING.z1 - 1; z += 5.5) {
      if (!open(x, z, 0.8) || inRoom(x, z) || cols.some(c => Math.abs(c.x - x) < 1 && Math.abs(c.z - z) < 0.4)) continue;
      bat.push(mat4(x, H - 0.05, z));
    }
    for (const Z of zones) if (Z.kind === 'shelter') for (const r of Z.walk.slice(0, Z.own)) for (let x = r.x0 + 2; x < r.x1 - 1; x += 5) for (let z = r.z0 + 1.6; z < r.z1 - 0.8; z += 4) bat.push(mat4(x, H - 0.05, z));
    KIT.instanced(W, ctx.geo('pkBat', () => new T.BoxGeometry(1.5, 0.05, 0.1)), M('ledCool'), bat);
    try { KIT.floorPools(wctx, bat.filter((_, i) => i % 2 === 0).map(m => { const p = new T.Vector3().setFromMatrixPosition(m); return [p.x, p.z]; }), 3.6, 'poolCool'); } catch (e) { /* optional */ }
    // sprinkler mains and a cable tray under the ceiling (they vanish inside the closed blocks)
    const pipe = (mat, rad, x0, z0, x1, z1, y) => { const L = Math.hypot(x1 - x0, z1 - z0), g = new T.CylinderGeometry(rad, rad, L, 8); g.rotateZ(Math.PI / 2); B.add(M(mat), g, mat4((x0 + x1) / 2, y, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0))); };
    const fx = t => PARKING.x0 + (PARKING.x1 - PARKING.x0) * t, fz = t => PARKING.z0 + (PARKING.z1 - PARKING.z0) * t;
    for (const t of [0.15, 0.415, 0.6]) pipe('pipeRed', 0.045, fx(t), fz(0.21), fx(t), fz(0.99), H - 0.16);
    for (const t of [0.43, 0.64]) pipe('pipeRed', 0.045, fx(0.03), fz(t), fx(0.99), fz(t), H - 0.27);
    for (const t of [0.44]) pipe('steel', 0.03, fx(0.03), fz(t), fx(0.99), fz(t), H - 0.12);
  }
  // compartment plaques on the fire wall
  if (Lay.wallRect) for (const g of gates) for (const s of [-1, 1]) sign(s < 0 ? 'Відсік 2' : 'Відсік 1', g.x + s * (WT / 2 + 0.005), g.h + 0.35, g.z, [s, 0], g.car ? 2.0 : 1.2);
  if (PARKING.shelter) for (const r of ramps) { const [x, z] = r.W2(r.len + 3.5, (r.l0 + r.l1) / 2); if (open(x, z, 0.3)) hang('Укриття', x, z, r.h, 2.0); }

  B.flush(W); C.flush(W); signB.flush(W); sb.flush(W);
  for (const m of topB.flush(W, { ceiling: true }) || []) m.userData.ceiling = true;

  // ---------------------------------------------------------------- light rig (building-local) and result
  const sp = spawns[bId], loc = (x, z) => worldToLocal(bId, x, z);
  const myLobby = zones.find(z => z.id === bId && z.kind === 'lobby');
  const spots = [];
  if (myLobby) for (const r of myLobby.walk.slice(0, Math.min(2, myLobby.own))) { const [x, z] = loc((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2); spots.push([x, 2.4, z, 5, 0xffe6c4, 8]); }
  { const [x, z] = loc(sp.x, sp.z); spots.push([x, 2.3, z, 5, 0xf2f4ff, 20]); }
  if (sp.door) { const [x, z] = loc(sp.x + sp.door.n[0] * 9, sp.z + sp.door.n[1] * 9); spots.push([x, 2.3, z, 4, 0xf2f4ff, 20]); }
  try { KIT.claimRig(ctx.root, spots.slice(0, 4), 0.34); } catch (e) { console.warn('[parking] lights', e); }

  const [spx, spz] = loc(sp.x, sp.z);
  const res = KIT.finish(ctx, { x: spx, z: spz, yaw: sp.yaw - rotY });
  res.parking = { places: bays.length, bays: bays.map(b => ({ no: b.no, x: b.x, z: b.z, axis: b.a ? 'z' : 'x', length: b.L, width: b.w, dir: b.dv })),
    spawns: Object.fromEntries(Object.entries(spawns).map(([k, s]) => [k, { x: s.x, z: s.z, yaw: s.yaw }])), world: W, ceiling: W.getObjectByName('vrc-parking-ceiling') };
  if (res.parkedCars == null) res.parkedCars = ctx.parkedCars;
  if (res.carInstances === undefined) res.carInstances = ctx.carInstances || null;
  const d0 = res.dispose ? res.dispose.bind(res) : () => {};
  res.dispose = () => { d0(); for (const m of ownMat) m.dispose(); for (const g of ownGeo) g.dispose(); };
  return res;
}
