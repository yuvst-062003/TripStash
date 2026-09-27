/**
 * The markers for whatever the camera is looking at.
 *
 * Pins appear only after the camera settles. During a flight they would slide
 * across the screen at a different rate from the map beneath them, which reads
 * as a bug - and a pin you have to chase is worse than no pin at all.
 *
 * A place with no coordinates is not pinned. It is still in the list beside the
 * map, which is where it can be read and pressed; the map is a second view of
 * that list, never the only one.
 */
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Scope } from '../lib/scope'
import { type Pin, type PinData, pinsFor } from '../lib/pins'
import { marksFor } from './Evidence'

export type { Pin, PinData }
export { pinsFor }

interface Props {
  map: maplibregl.Map | null
  scope: Scope
  data: PinData
  /** True once the camera has stopped. Pins appear only then. */
  settled: boolean
  onPress: (id: string) => void
}

export default function MapPins({ map, scope, data, settled, onPress }: Props) {
  const markers = useRef<maplibregl.Marker[]>([])
  const press = useRef(onPress)
  press.current = onPress

  useEffect(() => {
    if (!map) return

    for (const marker of markers.current) marker.remove()
    markers.current = []
    if (!settled) return

    for (const pin of pinsFor(scope, data)) {
      const host = document.createElement('div')
      host.className = pin.here ? 'mappin mappin--here' : 'mappin'

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mappin__label'

      const name = document.createElement('span')
      name.className = 'mappin__name'
      name.textContent = pin.name
      button.append(name)

      // A mark at pin size is noise rather than information, so the count goes
      // in words instead - the marks themselves live in the list below.
      if (pin.found > 0) {
        const note = document.createElement('span')
        note.className = 'mappin__found'
        note.textContent = `${pin.found} found`
        button.append(note)
      }

      button.setAttribute(
        'aria-label',
        `${pin.name}, ${marksFor(pin.yours, pin.found).marks.length ? `${pin.yours} yours and ${pin.found} found` : 'nothing saved yet'}`,
      )
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        press.current(pin.id)
      })

      const stem = document.createElement('span')
      stem.className = 'mappin__stem'
      stem.setAttribute('aria-hidden', 'true')
      const dot = document.createElement('span')
      dot.className = 'mappin__dot'
      dot.setAttribute('aria-hidden', 'true')

      host.append(button, stem, dot)
      markers.current.push(
        new maplibregl.Marker({ element: host, anchor: 'bottom' })
          .setLngLat([pin.lon, pin.lat])
          .addTo(map),
      )
    }

    return () => {
      for (const marker of markers.current) marker.remove()
      markers.current = []
    }
  }, [map, scope, data, settled])

  return null
}
