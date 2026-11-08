// Fortschrittsbalken: mit `percent` ein gefüllter Balken, ohne ein laufender Streifen
// (Ende unbekannt). Gleiche Klassen wie vorher in TranspileProgress und TranspileMatchDialog.

export function ProgressBar({ percent, label }: { percent?: number | null; label: string }) {
  if (percent === undefined || percent === null) return <div className="forge-progress-stripe" role="progressbar" aria-label={label} aria-busy="true" />
  return (
    <div className="forge-progress-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <div className="forge-progress-bar-fill" style={{ width: `${percent}%` }} />
    </div>
  )
}
