import type { ComponentProps, KeyboardEvent, PropsWithChildren, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { PurchaseDialog } from './purchase-dialog'

// Tests our composition and handlers, not Radix's browser-only focus/portal implementation.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <>{children}</>,
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h3>{children}</h3>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogClose: ({ children }: PropsWithChildren) => <>{children}</>,
}))

function dialog(overrides: Partial<ComponentProps<typeof PurchaseDialog>> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn()
  const props = { title: 'Record Payment', onClose, onSubmit, canSubmit: true, submitting: false, submitLabel: 'Save Payment', children: <input aria-label="Amount" />, ...overrides }
  const root = PurchaseDialog(props) as ReactElement<ComponentProps<typeof Dialog>>
  const content = root.props.children as ReactElement<ComponentProps<typeof DialogContent>>
  return { root, content, onClose, onSubmit, html: renderToStaticMarkup(root) }
}

function keyEvent(overrides: Partial<KeyboardEvent<HTMLDivElement>> = {}) {
  return { key: 'Enter', ctrlKey: true, metaKey: false, preventDefault: vi.fn(), ...overrides } as unknown as KeyboardEvent<HTMLDivElement>
}

describe('PurchaseDialog', () => {
  it('composes the existing controlled dialog, content, title, and footer without a second handwritten overlay', () => {
    const { root, content, html, onClose } = dialog()
    expect(root.type).toBe(Dialog)
    expect(root.props.open).toBe(true)
    expect(content.type).toBe(DialogContent)
    expect(content.props.showCloseButton).toBe(false)
    expect(content.props['aria-describedby']).toBeUndefined()
    const sections = content.props.children as ReactElement[]
    expect((sections[0].props as { children: ReactElement[] }).children[0].type).toBe(DialogTitle)
    expect(sections[2].type).toBe(DialogFooter)
    expect(html).toContain('Record Payment')
    expect(html).toContain('Save Payment')
    expect(html).toContain('aria-label="Close"')
    root.props.onOpenChange?.(false)
    expect(onClose).toHaveBeenCalledOnce()
    root.props.onOpenChange?.(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([{ ctrlKey: true, metaKey: false }, { ctrlKey: false, metaKey: true }])('preserves modifier+Enter submission for $ctrlKey/$metaKey', (modifiers) => {
    const { content, onSubmit } = dialog()
    const event = keyEvent(modifiers)
    content.props.onKeyDown?.(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it.each([{ canSubmit: false }, { submitting: true }, { submitLabel: '', canSubmit: false }])('does not submit disabled, pending, or read-only dialogs: %j', (overrides) => {
    const { content, onSubmit, html } = dialog(overrides)
    content.props.onKeyDown?.(keyEvent())
    expect(onSubmit).not.toHaveBeenCalled()
    if (overrides.submitLabel === '') expect(html).not.toContain('Save Payment')
    else expect(html).toContain('disabled=""')
  })

  it('leaves ordinary Enter and Escape to the focused control and dialog primitive', () => {
    const { content, onSubmit, onClose } = dialog()
    content.props.onKeyDown?.(keyEvent({ ctrlKey: false }))
    content.props.onKeyDown?.(keyEvent({ key: 'Escape' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('retains compact slate styling, destructive tone, and the larger details width', () => {
    const { content, html } = dialog({ title: 'Cancel Bill', tone: 'danger', width: 'max-w-lg', submitting: true })
    expect(content.props.className).toContain('sm:max-w-lg')
    expect(content.props.className).toContain('bg-white')
    expect(content.props.className).toContain('z-[80]')
    expect(html).toContain('bg-destructive')
    expect(html).toContain('Saving…')
  })
})
