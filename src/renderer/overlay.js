let start = null
const box = document.getElementById('box')
document.addEventListener('mousedown', e => {
  start = { x: e.clientX, y: e.clientY }
  box.style.left = `${start.x}px`
  box.style.top = `${start.y}px`
  box.style.width = '0px'
  box.style.height = '0px'
  box.style.display = 'block'
})
document.addEventListener('mousemove', e => {
  if (!start) return
  const x = Math.min(e.clientX, start.x)
  const y = Math.min(e.clientY, start.y)
  const w = Math.abs(e.clientX - start.x)
  const h = Math.abs(e.clientY - start.y)
  box.style.left = `${x}px`
  box.style.top = `${y}px`
  box.style.width = `${w}px`
  box.style.height = `${h}px`
})
document.addEventListener('mouseup', _e => {})
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window.overlay.cancel()
  if (e.key === 'Enter' && start) {
    const rect = box.getBoundingClientRect()
    window.overlay.submit({ x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) })
  }
})
