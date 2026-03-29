'use client'

import {
  Lightbulb,
  MousePointer2,
  Palette,
  Maximize2,
  Waypoints,
  StickyNote,
} from 'lucide-react'
import { Section, FeatureCard } from './shared'

const CANVAS_FEATURES = [
  {
    icon: StickyNote,
    title: 'Nodes',
    description: 'Create text nodes for brainstorming, planning, or documentation. Resize and reposition freely.',
  },
  {
    icon: Waypoints,
    title: 'Edges',
    description: 'Connect nodes with edges to show relationships and flow between ideas.',
  },
  {
    icon: Palette,
    title: 'Color Coding',
    description: 'Assign colors to nodes for visual categorization. Matches your theme palette.',
  },
  {
    icon: Maximize2,
    title: 'Mini Map',
    description: 'Navigate large canvases with the mini map overlay. Click to jump to any area.',
  },
  {
    icon: MousePointer2,
    title: 'Pan & Zoom',
    description: 'Scroll to zoom, click-drag background to pan. Fit all nodes with the fit view button.',
  },
  {
    icon: Lightbulb,
    title: 'Freeform Layout',
    description: 'No grid constraints. Place nodes anywhere for organic brainstorming sessions.',
  },
]

export function CanvasTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-300 leading-relaxed">
        The Canvas is an infinite whiteboard for freeform brainstorming, mind mapping, and visual planning.
        Create nodes, connect them with edges, and organize ideas spatially.
      </p>

      <Section title="Features">
        <div className="grid grid-cols-2 gap-3">
          {CANVAS_FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </Section>

      <Section title="Controls">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>Double-click the canvas background to create a new node</li>
          <li>Double-click a node to edit its text content</li>
          <li>Drag from a node handle to create an edge to another node</li>
          <li>Select a node or edge and press Delete to remove it</li>
          <li>Use the controls in the bottom-left to zoom and fit the view</li>
        </ul>
      </Section>
    </div>
  )
}
