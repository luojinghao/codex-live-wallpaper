$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'codexpp.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.id -notmatch '^[a-z0-9_-]+$' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Invalid extension id or version.'
}

$files = @('codexpp.json', 'renderer.js', 'backend/main.mjs', 'README.md')
$docs = Get-ChildItem -LiteralPath (Join-Path $root 'docs') -File -Filter '*.md'
foreach ($doc in $docs) { $files += 'docs/' + $doc.Name }
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $file) -PathType Leaf)) {
        throw "Missing package file: $file"
    }
}

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$name = "$($manifest.id)-v$($manifest.version).zip"
$output = Join-Path $dist $name
if (Test-Path -LiteralPath $output) { throw "Archive already exists: $output" }

$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, (Join-Path $root $file), $file, [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally { $zip.Dispose() }

$zip = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
    if (-not ($zip.Entries.FullName -contains 'codexpp.json')) { throw 'Manifest is not at archive root.' }
    $bytes = ($zip.Entries | Measure-Object -Property Length -Sum).Sum
    if ($zip.Entries.Count -gt 2000 -or $bytes -gt 10MB) { throw 'Archive exceeds Codex++ package limits.' }
} finally { $zip.Dispose() }

$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $name" | Set-Content -LiteralPath (Join-Path $dist 'SHA256SUMS.txt') -Encoding ASCII
Write-Output "Created $output"
Write-Output "SHA256 $hash"
