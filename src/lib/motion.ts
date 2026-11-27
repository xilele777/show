let supportsDisplayTransition: boolean | undefined

export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition
  if (typeof window === 'undefined' || !window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;'
  document.body.appendChild(probe)
  getComputedStyle(probe).display
  probe.style.display = 'none'
  supportsDisplayTransition = getComputedStyle(probe).display === 'block'
  probe.remove()
  return supportsDisplayTransition
}

export function supportsTopLayerExit(): boolean {
  return typeof window !== 'undefined' && Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay()
}

export async function closeTopLayer(element: HTMLDialogElement | undefined): Promise<void> {
  if (!element || !element.open) return
  if (!supportsTopLayerExit()) {
    element.setAttribute('data-closing', '')
    const animations = element.getAnimations({ subtree: true })
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise<void>((resolve) => setTimeout(resolve, 600))
      ])
    }
    if (!element.hasAttribute('data-closing')) return
    element.removeAttribute('data-closing')
  }
  if (element.open) element.close()
}

export function setupDialogLightDismiss(dialog: HTMLDialogElement, onClose: () => void): () => void {
  const onCancel = (event: Event) => {
    event.preventDefault()
    void closeTopLayer(dialog).then(() => {
      if (!dialog.open) onClose()
    })
  }
  dialog.addEventListener('cancel', onCancel)

  if ('closedBy' in HTMLDialogElement.prototype) {
    return () => {
      dialog.removeEventListener('cancel', onCancel)
    }
  }

  let pressedOutside = false
  const isOutside = (event: PointerEvent) => {
    const rect = dialog.getBoundingClientRect()
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
  }
  const onPointerDown = (event: PointerEvent) => {
    pressedOutside = isOutside(event)
  }
  const onPointerUp = (event: PointerEvent) => {
    if (pressedOutside && isOutside(event)) {
      void closeTopLayer(dialog).then(() => {
        if (!dialog.open) onClose()
      })
    }
    pressedOutside = false
  }
  dialog.addEventListener('pointerdown', onPointerDown)
  dialog.addEventListener('pointerup', onPointerUp)

  return () => {
    dialog.removeEventListener('cancel', onCancel)
    dialog.removeEventListener('pointerdown', onPointerDown)
    dialog.removeEventListener('pointerup', onPointerUp)
  }
}

export function runViewTransition(update: () => void | Promise<void>): Promise<void> {
  if (
    typeof document === 'undefined' ||
    !('startViewTransition' in document) ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return Promise.resolve(update()).then(() => undefined)
  }
  const transition = (document as Document & { startViewTransition: (cb: () => void | Promise<void>) => { finished: Promise<void> } }).startViewTransition(update)
  return transition.finished.catch(() => undefined)
}
