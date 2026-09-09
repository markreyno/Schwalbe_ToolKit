# Convert the existing Schwalbe artwork into a multi-resolution Windows icon.
Add-Type -AssemblyName System.Drawing
$projectDirectory = Split-Path $PSScriptRoot -Parent
$sourceImage = [System.Drawing.Image]::FromFile((Join-Path $projectDirectory 'src/assets/schwalbe-supersign.png'))
$iconSizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
try {
    foreach ($size in $iconSizes) {
        $bitmap = New-Object System.Drawing.Bitmap($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $stream = New-Object System.IO.MemoryStream
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $images += ,$stream.ToArray()
        } finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
    $assetDirectory = Join-Path $projectDirectory 'assets'
    [System.IO.Directory]::CreateDirectory($assetDirectory) | Out-Null
    $output = [System.IO.File]::Create((Join-Path $assetDirectory 'schwalbe.ico'))
    $writer = New-Object System.IO.BinaryWriter($output)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$iconSizes.Count)
        $offset = 6 + 16 * $iconSizes.Count
        for ($i = 0; $i -lt $iconSizes.Count; $i++) {
            $dimension = $iconSizes[$i] % 256
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
            $offset += $images[$i].Length
        }
        foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
    } finally { $writer.Dispose(); $output.Dispose() }
} finally { $sourceImage.Dispose() }
