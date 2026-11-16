import { useState } from 'react'
import { clampZoom, loadUiZoom, setUiZoom, UI_ZOOM_MAX, UI_ZOOM_MIN } from '../settings/zoom'
import { TextAndDensity } from './TextAndDensity'
import { Button, Input } from '../core/ui/controls'

/** Options > Appearance > Text & size: alles, was die Größe der Oberfläche bestimmt. */
export function TextAndSizePage() {
  const [zoom, setZoom] = useState(() => loadUiZoom())
  return (
    <>
      <h3>Text &amp; size</h3>
      <p className="forge-field-hint">How large the interface is. Changes apply at once.</p>
      <fieldset className="forge-opt-group">
        <legend>Interface size</legend>
        <p className="forge-field-hint">Scales the whole window. Ctrl+Shift+Plus, Minus and 0 do the same.</p>
        <div className="gen-zoom">
          <Input
            type="range"
            aria-label="Interface size"
            min={UI_ZOOM_MIN * 100}
            max={UI_ZOOM_MAX * 100}
            step={10}
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(setUiZoom(clampZoom(Number(e.target.value) / 100)))}
          />
          <output>{Math.round(zoom * 100)} %</output>
          <Button variant="bare" isDisabled={zoom === 1} onClick={() => setZoom(setUiZoom(1))}>
            Reset
          </Button>
        </div>
      </fieldset>
      <fieldset className="forge-opt-group">
        <legend>Text and density</legend>
        <p className="forge-field-hint">Base text size, font and spacing. Parts that still use fixed pixel sizes follow later.</p>
        <TextAndDensity />
      </fieldset>
    </>
  )
}
