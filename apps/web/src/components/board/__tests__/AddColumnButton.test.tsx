/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AddColumnButton } from '../AddColumnButton'

// A slim rail on touch devices, the labelled placeholder on desktop.

function stubPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (queryString: string) => ({
    matches: queryString.includes('pointer: coarse') ? coarse : false,
    media: queryString,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AddColumnButton', () => {
  it('is a slim icon-only rail on a coarse pointer', () => {
    stubPointer(true)
    const onClick = vi.fn()
    render(<AddColumnButton onClick={onClick} />)
    const button = screen.getByRole('button', { name: /add column/i })
    expect(button.className).toContain('w-12')
    expect(button.className).not.toContain('min-w-[200px]')
    expect(button.textContent).toBe('')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the labelled placeholder on a fine pointer', () => {
    stubPointer(false)
    render(<AddColumnButton onClick={vi.fn()} />)
    const button = screen.getByRole('button', { name: /add column/i })
    expect(button.className).toContain('min-w-[200px]')
    expect(button.textContent).toContain('Add Column')
  })
})
