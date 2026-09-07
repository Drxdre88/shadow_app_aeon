import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemberAvatar } from '@/components/ui/MemberAvatar'

const base = { name: 'Andrey Selikhov', email: 'a@example.com', image: 'https://img.example/a.png' }

describe('MemberAvatar — styling beats the photo', () => {
  it('an unstyled member with a photo still shows the photo', () => {
    const { container } = render(<MemberAvatar member={base} />)
    expect(container.querySelector('img')).not.toBeNull()
    expect(screen.queryByText('AS')).toBeNull()
  })

  it('custom initials replace the photo without any board setting', () => {
    const { container } = render(<MemberAvatar member={{ ...base, initials: 'AS' }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AS')).toBeTruthy()
  })

  it('a fill colour alone also replaces the photo, with derived initials', () => {
    const { container } = render(<MemberAvatar member={{ ...base, color: '#112233' }} />)
    expect(container.querySelector('img')).toBeNull()
    const el = screen.getByText('AS')
    expect(el.getAttribute('style')).toContain('#112233')
  })

  it('text colour and shape land on the element', () => {
    render(<MemberAvatar member={{ ...base, initials: 'AS', textColor: '#ffeeaa', shape: 'square' }} />)
    const el = screen.getByText('AS')
    expect(el.className).toContain('rounded-none')
    expect(el.getAttribute('style')).toMatch(/color:\s*(#ffeeaa|rgb\(255, 238, 170\))/)
  })

  it('preferInitials hides the photo for an unstyled member too', () => {
    const { container } = render(<MemberAvatar member={base} preferInitials />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AS')).toBeTruthy()
  })
})
