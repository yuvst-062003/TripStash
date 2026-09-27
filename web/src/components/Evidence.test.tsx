import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Evidence, { marksFor } from './Evidence'

describe('marksFor', () => {
  it('draws one mark per clip', () => {
    expect(marksFor(1, 3).marks).toEqual(['inked', 'dry', 'dry', 'dry'])
  })

  it('draws nothing at all when there is nothing behind a place', () => {
    expect(marksFor(0, 0)).toEqual({ marks: [], rest: 0 })
  })

  // Past four you stop counting and start reading a bar, which is a different
  // and less useful reading.
  it('caps at four and turns the remainder into a figure', () => {
    expect(marksFor(6, 0)).toEqual({ marks: ['inked', 'inked', 'inked', 'inked'], rest: 2 })
  })

  it('spends the cap on yours first, because yours is the stronger claim', () => {
    expect(marksFor(3, 4).marks).toEqual(['inked', 'inked', 'inked', 'dry'])
    expect(marksFor(3, 4).rest).toBe(3)
  })

  it('shows found marks when none of it is yours yet', () => {
    expect(marksFor(0, 2).marks).toEqual(['dry', 'dry'])
  })
})

describe('Evidence', () => {
  it('says in words what the marks say in shapes', () => {
    render(<Evidence yours={1} found={3} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      '1 yours, 3 found and not yet stamped',
    )
  })

  it('does not claim anything is yours when nothing is', () => {
    render(<Evidence yours={0} found={5} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      '5 found, none of them yours yet',
    )
  })

  it('reads singular when there is one of something', () => {
    render(<Evidence yours={1} found={0} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('1 clip, yours')
  })

  it('renders nothing rather than an empty label when there is no evidence', () => {
    const { container } = render(<Evidence yours={0} found={0} />)
    expect(container.firstChild).toBeNull()
  })

  // Colour is never the only signal: an inked mark is filled and solid-edged,
  // a dry one is hollow and dashed.
  it('separates the two kinds by more than colour', () => {
    const { container } = render(<Evidence yours={1} found={1} />)
    const marks = container.querySelectorAll('.mark')
    expect(marks[0].className).toContain('mark--inked')
    expect(marks[1].className).toContain('mark--dry')
  })
})
