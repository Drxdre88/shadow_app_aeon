declare module 'd3-force-3d' {
  // Minimal ambient declarations for the slice we use. d3-force-3d ships ESM
  // JS without bundled types; the upstream d3-force types are close but not
  // a drop-in match. We model only what Cortex2D imports.

  export interface SimulationNode {
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
  }

  export interface Simulation<N extends SimulationNode = SimulationNode> {
    stop(): this
    restart(): this
    tick(iterations?: number): this
    alpha(): number
    alpha(value: number): this
    alphaDecay(): number
    alphaDecay(value: number): this
    nodes(): N[]
    nodes(nodes: N[]): this
    force(name: string): unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    force(name: string, force: any): this
    on(event: string, listener: () => void): this
  }

  export function forceSimulation<N extends SimulationNode = SimulationNode>(
    nodes?: N[],
    numDimensions?: 1 | 2 | 3,
  ): Simulation<N>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceManyBody(): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceLink<L = any>(links?: L[]): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceCenter(x?: number, y?: number, z?: number): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceCollide(radius?: number | ((d: unknown) => number)): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceX(x?: number): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceY(y?: number): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceZ(z?: number): any
}
