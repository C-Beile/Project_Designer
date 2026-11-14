import { Label, Slider as AriaSlider, SliderOutput, SliderThumb, SliderTrack, type SliderProps as AriaSliderProps } from 'react-aria-components'

export interface SliderProps extends Omit<AriaSliderProps<number>, 'className' | 'children'> {
  label: string
  /** Einheit hinter dem Wert, z. B. "px". */
  unit?: string
}

export function Slider({ label, unit, ...props }: SliderProps) {
  return (
    <AriaSlider {...props} className="ui-Slider">
      <Label>{label}</Label>
      <SliderOutput className="ui-Slider-output">{({ state }) => `${state.getThumbValueLabel(0)}${unit ? ` ${unit}` : ''}`}</SliderOutput>
      <SliderTrack className="ui-Slider-track">
        <SliderThumb className="ui-Slider-thumb" />
      </SliderTrack>
    </AriaSlider>
  )
}
