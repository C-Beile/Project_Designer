# Prueft die Ordner-Karten (CLAUDE.md in Unterordnern) gegen die echten Dateien.
# Nutzung: powershell -File scripts/check-maps.ps1 [-Root <Ordner>] [-Fix]
#   Root: Standard = Projektroot (Ordner ueber scripts/). Die CLAUDE.md direkt im Root wird nicht geprueft.
#   Fehler: Pfad in der Tabelle existiert nicht ("fehlt") oder Datei/Ordner ohne Eintrag ("neu").
#   Warnung: Karte ohne AUTO-Block oder Zeile mit "TODO". Exit-Code = Anzahl Fehler.
#   -Fix: ergaenzt fehlende Eintraege als "| `name` | TODO |"; tote Zeilen werden nur gemeldet.
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [switch]$Fix
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
$skipDirs = @('node_modules', 'target', 'dist', '.git')
$ignoreFiles = @('*.test.*', '*.css', '*.generated.*', '*.snap', 'CLAUDE.md', 'GEMINI.md', 'Cargo.lock')
$utf8 = New-Object System.Text.UTF8Encoding($false)
$startMark = '<!-- AUTO:START -->'
$endMark = '<!-- AUTO:END -->'

# Alle Karten in Unterordnern finden (ohne die ausgeschlossenen Ordner).
function Find-Maps([string]$dir, [bool]$isRoot) {
    foreach ($item in Get-ChildItem -LiteralPath $dir -Force) {
        if ($item.PSIsContainer) {
            if ($skipDirs -contains $item.Name) { continue }
            Find-Maps $item.FullName $false
        } elseif (-not $isRoot -and $item.Name -eq 'CLAUDE.md') {
            $item.FullName
        }
    }
}

function Get-Rel([string]$path) {
    $path.Substring($Root.Length).TrimStart('\').Replace('\', '/')
}

$errors = 0
$warnings = 0
$maps = @(Find-Maps $Root $true)

foreach ($map in $maps) {
    $rel = Get-Rel $map
    $dir = Split-Path -Parent $map
    $text = [System.IO.File]::ReadAllText($map, $utf8)
    $eol = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = [regex]::Split($text, "\r?\n")

    $s = -1; $e = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($s -lt 0 -and $lines[$i].Trim() -eq $startMark) { $s = $i }
        elseif ($s -ge 0 -and $lines[$i].Trim() -eq $endMark) { $e = $i; break }
    }
    if ($s -lt 0 -or $e -lt 0) {
        Write-Host "${rel}: Hinweis kein AUTO-Block"
        $warnings++
        continue
    }

    # Eintraege lesen
    $entries = @{}
    $lastTable = -1
    for ($i = $s + 1; $i -lt $e; $i++) {
        $l = $lines[$i]
        if ($l.TrimStart().StartsWith('|')) { $lastTable = $i }
        if ($l -match '^\s*\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|?\s*$') {
            $name = $Matches[1].Trim().Replace('\', '/').TrimEnd('/')
            $desc = $Matches[2].Trim()
            $entries[$name.ToLowerInvariant()] = $name
            if (-not (Test-Path -LiteralPath (Join-Path $dir $name))) {
                Write-Host "${rel}: fehlt $($Matches[1].Trim())"
                $errors++
            }
            if ($desc -eq 'TODO') {
                Write-Host "${rel}: Hinweis TODO bei $($Matches[1].Trim())"
                $warnings++
            }
        }
    }

    # Dateien/Ordner direkt im Kartenordner ohne Eintrag
    $missing = @()
    foreach ($item in Get-ChildItem -LiteralPath $dir -Force) {
        if ($item.PSIsContainer) {
            if ($item.Name.StartsWith('.') -or $skipDirs -contains $item.Name) { continue }
            $label = $item.Name + '/'
        } else {
            if ($item.Name.StartsWith('.')) { continue }
            $skip = $false
            foreach ($p in $ignoreFiles) { if ($item.Name -like $p) { $skip = $true; break } }
            if ($skip) { continue }
            $label = $item.Name
        }
        if (-not $entries.ContainsKey($item.Name.ToLowerInvariant())) { $missing += $label }
    }

    $fixed = $false
    foreach ($label in ($missing | Sort-Object)) {
        if ($Fix -and $lastTable -ge 0) {
            Write-Host "${rel}: ergaenzt $label"
            $fixed = $true
        } else {
            Write-Host "${rel}: neu $label"
            $errors++
        }
    }

    if ($fixed) {
        $new = @($missing | Sort-Object | ForEach-Object { '| `' + $_ + '` | TODO |' })
        $out = New-Object System.Collections.Generic.List[string]
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $out.Add($lines[$i])
            if ($i -eq $lastTable) { foreach ($n in $new) { $out.Add($n) } }
        }
        [System.IO.File]::WriteAllText($map, ($out -join $eol), $utf8)
    }
}

Write-Host "Fertig: $($maps.Count) Karten, $errors Fehler, $warnings Hinweise."
exit $errors
