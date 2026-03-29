import { toPng, toSvg } from 'html-to-image'

const EXPORT_FILTER = (node: Node) => {
  if (node instanceof HTMLElement) {
    const cls = node.classList
    if (cls?.contains('react-flow__controls') || cls?.contains('react-flow__minimap')) return false
  }
  return true
}

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export async function exportCanvasPng(element: HTMLElement, filename = 'canvas.png') {
  const dataUrl = await toPng(element, {
    backgroundColor: '#0a0a14',
    quality: 1,
    pixelRatio: 2,
    filter: EXPORT_FILTER,
  })
  triggerDownload(dataUrl, filename)
}

export async function exportCanvasSvg(element: HTMLElement, filename = 'canvas.svg') {
  const dataUrl = await toSvg(element, {
    backgroundColor: '#0a0a14',
    filter: EXPORT_FILTER,
  })
  triggerDownload(dataUrl, filename)
}
