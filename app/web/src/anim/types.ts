// Scene format for the data-driven animation player. See scene.schema.json for the JSON Schema.
export type Tone = 'accent' | 'good' | 'bad' | 'mid' | 'muted'
export type Cell = string | number
export type Vec2 = [number, number]

interface Base { id: string; tone?: Tone }
interface Pos extends Base { x?: number; y?: number }

export interface NodeObj extends Pos { kind: 'node'; label?: string; r?: number }
/** `edge` is a plain line, `arrow` has a head. Endpoints: from/to object ids (nodes, boxes, ...) or x1,y1,x2,y2. */
export interface EdgeObj extends Base {
  kind: 'edge' | 'arrow'; from?: string; to?: string
  x1?: number; y1?: number; x2?: number; y2?: number; label?: string; dash?: boolean
}
/** `fill:false` draws an outline only (use it for K-map groups, brackets, callouts). */
export interface BoxObj extends Pos { kind: 'box'; w: number; h: number; label?: string; fill?: boolean; dash?: boolean; square?: boolean }
/** A translucent filled circle, useful for overlapping sets. */
export interface CircleObj extends Base { kind: 'circle'; cx: number; cy: number; r: number; fillOpacity?: number }
export interface TextObj extends Pos { kind: 'text'; text: string; size?: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; mono?: boolean }
export interface MathObj extends Pos { kind: 'math'; tex: string; size?: number; w?: number; h?: number; anchor?: 'start' | 'middle' | 'end' }
/** x,y: top-left of the row (dir right/down) or top-left of the bottom slot's column with y = baseline (dir up). */
export interface ArrayObj extends Pos {
  kind: 'array'; cells: Cell[]; cw?: number; ch?: number; dir?: 'right' | 'up' | 'down'
  indices?: boolean; slots?: number; label?: string
}
export interface MatrixObj extends Pos { kind: 'matrix'; values: Cell[][]; cw?: number; ch?: number; label?: string }
export interface GridObj extends Pos {
  kind: 'grid'; rows: number; cols: number; cells?: Cell[] | Cell[][]; cw?: number; ch?: number
  rowLabels?: string[]; colLabels?: string[]; rowTitle?: string; colTitle?: string
}
export interface BarObj extends Pos { kind: 'bar'; values: number[]; labels?: string[]; w?: number; h?: number; max?: number; hideZero?: boolean }
/** x,y: SVG position of the origin. unit: pixels per unit. */
export interface AxisObj extends Pos { kind: 'axis'; unit?: number; xr?: Vec2; yr?: Vec2; xlabel?: string; ylabel?: string }
export interface PointObj extends Base { kind: 'point'; axis: string; at: Vec2; label?: string; hollow?: boolean }
export interface VectorObj extends Base { kind: 'vector'; axis: string; to: Vec2; from?: Vec2; label?: string; dash?: boolean }
export interface CurveObj extends Base { kind: 'curve'; axis: string; fn?: string; points?: Vec2[]; domain?: Vec2; dash?: boolean }
export interface TreeNode { id?: string; label: string; children?: TreeNode[] }
export interface TreeObj extends Pos { kind: 'tree'; root: TreeNode; dx?: number; dy?: number; r?: number }
/** Arrow pointing at a cell of an array. Move it with a `move` op: {id, index}. */
export interface PointerObj extends Base { kind: 'pointer'; array: string; index: number; label?: string; side?: 'above' | 'below' | 'left' | 'right' }

export type SceneObject =
  | NodeObj | EdgeObj | BoxObj | CircleObj | TextObj | MathObj | ArrayObj | MatrixObj | GridObj | BarObj
  | AxisObj | PointObj | VectorObj | CurveObj | TreeObj | PointerObj
export type Kind = SceneObject['kind']

/** An id, or {id, cells, tone} to highlight only some cells of an array/matrix/grid/bar (flat index or [row, col]). */
export type HighlightRef = string | { id: string; cells?: (number | Vec2)[]; tone?: Tone }
export interface MoveOp { id: string; x?: number; y?: number; index?: number; arc?: { cx: number; cy: number } }
export interface SetOp { id: string; label?: string; text?: string; tex?: string; value?: Cell; cells?: Cell[] | Cell[][]; values?: number[] | Cell[][]; tone?: Tone }
export interface SwapOp { id: string; i: number; j: number }
export interface PushOp { id: string; value: Cell }
export interface PopOp { id: string; end?: 'back' | 'front' }
export interface DimRef { id: string; cells?: (number | Vec2)[] }

/** Every op field also accepts a single item instead of an array. Highlights last one step; dim/set/tone persist. */
export interface Step {
  caption: string; math?: string
  show?: string | string[]; hide?: string | string[]
  highlight?: HighlightRef | HighlightRef[]
  dim?: string | DimRef | (string | DimRef)[]; undim?: string | string[]
  move?: MoveOp | MoveOp[]; set?: SetOp | SetOp[]
  draw?: string | string[]; animate?: { id: string; prop: 'draw' } | { id: string; prop: 'draw' }[]
  swap?: SwapOp | SwapOp[]; push?: PushOp | PushOp[]; pop?: PopOp | PopOp[]
}

export interface Scene { id: string; title: string; viewBox?: [number, number, number, number]; objects: SceneObject[]; steps: Step[] }

export interface Example { level?: 'basic' | 'gate' | 'twist'; setup?: string; steps?: string[]; answer?: string }
export interface Check { q: string; a: string }
/** v2 fields (spec 12) plus v1 fields (`what`/`why`/`how`/`trap`, each with an optional `_full`) so old files keep rendering. Prefer v2 when present. */
export interface Card {
  atom_id?: string; title?: string
  idea?: string; idea_full?: string; simple?: string; definition?: string; intuition_full?: string
  example?: Example | string; examples?: Example[]
  why?: string; why_full?: string
  how?: string[]; how_full?: string[]
  mistake?: string; edge_cases?: string[]; connections?: string[]
  check?: Check | Check[]; asked?: string
  what?: string; what_full?: string
  trap?: string; trap_full?: string
  scene?: string
  try?: string | { id?: string; label: string }
}
export interface ChapterNote { about?: string; simple?: string; concept_map?: { atom_id: string; title: string; one_line?: string }[]; gate_patterns?: string[] }
export interface ExplainerFile { topic_id: string; title?: string; chapter_note?: ChapterNote; cards: Card[]; scenes?: Scene[] }
