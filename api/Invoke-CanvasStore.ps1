function Get-CanvasDir {
    $dir = Join-Path $global:WebRoot "canvas"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return $dir
}

function Get-CanvasSafeName {
    param([string]$Name)
    $n = [string]$Name
    if ([string]::IsNullOrWhiteSpace($n)) { $n = "infra" }
    $n = [System.IO.Path]::GetFileNameWithoutExtension($n.Trim())
    foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) {
        $n = $n.Replace([string]$c, "_")
    }
    $n = ($n -replace '[\\/:*?"<>|]', '_')
    $n = ($n -replace '\s+', ' ').Trim()
    if ($n -match '\.\.') { throw "Invalid canvas name" }
    if ([string]::IsNullOrWhiteSpace($n)) { throw "Invalid canvas name" }
    if ($n.Length -gt 80) { $n = $n.Substring(0, 80) }
    return $n
}

function Get-CanvasQueryName {
    param($Request)
    $n = $null
    try { $n = $Request.QueryString["name"] } catch {}
    if ([string]::IsNullOrWhiteSpace($n)) {
        try {
            $q = [string]$Request.Url.Query
            if ($q -match '[?&]name=([^&]*)') {
                $n = [System.Uri]::UnescapeDataString(($Matches[1] -replace '\+', ' '))
            }
        } catch {}
    }
    if ([string]::IsNullOrWhiteSpace($n)) { return "infra" }
    return $n
}

function Get-CanvasPath {
    param([string]$Name)
    return (Join-Path (Get-CanvasDir) ((Get-CanvasSafeName -Name $Name) + ".canvas"))
}

function ConvertTo-CanvasJsonString {
    param([string]$s)
    if ([string]::IsNullOrEmpty($s)) { return '""' }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $s.ToCharArray()) {
        $code = [int]$ch
        switch ($ch) {
            '"'  { [void]$sb.Append('\"'); continue }
            '\'  { [void]$sb.Append('\\'); continue }
            "`n" { [void]$sb.Append('\n'); continue }
            "`r" { [void]$sb.Append('\r'); continue }
            "`t" { [void]$sb.Append('\t'); continue }
            default {
                if ($code -lt 32) { [void]$sb.Append('\u{0:x4}' -f $code) }
                else { [void]$sb.Append($ch) }
            }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Get-CanvasListJson {
    $rows = New-Object System.Collections.Generic.List[string]

    foreach ($f in (Get-ChildItem -Path (Get-CanvasDir) -Filter "*.canvas" -File -ErrorAction SilentlyContinue | Sort-Object Name)) {
        $nodes = 0
        $edges = 0
        try {
            $data  = Get-Content $f.FullName -Raw | ConvertFrom-Json
            $nodes = @($data.nodes).Count
            $edges = @($data.edges).Count
        } catch {}

        $sb = New-Object System.Text.StringBuilder
        [void]$sb.Append('{"name":')
        [void]$sb.Append((ConvertTo-CanvasJsonString $f.BaseName))
        [void]$sb.Append(',"nodes":')
        [void]$sb.Append([int]$nodes)
        [void]$sb.Append(',"edges":')
        [void]$sb.Append([int]$edges)
        [void]$sb.Append(',"size":')
        [void]$sb.Append([int64]$f.Length)
        [void]$sb.Append(',"updated_at":')
        [void]$sb.Append((ConvertTo-CanvasJsonString ($f.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))))
        [void]$sb.Append('}')
        $rows.Add($sb.ToString())
    }

    return '[' + ($rows -join ',') + ']'
}

function Read-CanvasFile {
    param([string]$Name)
    $path = Get-CanvasPath -Name $Name
    if (-not (Test-Path $path)) { return '{"nodes":[],"edges":[]}' }
    return [System.IO.File]::ReadAllText($path)
}

function Write-CanvasFile {
    param([string]$Name, [string]$Json)
    $null = $Json | ConvertFrom-Json
    $path = Get-CanvasPath -Name $Name
    $tmp  = $path + ".tmp"
    [System.IO.File]::WriteAllText($tmp, $Json, [System.Text.UTF8Encoding]::new($false))
    if (Test-Path $path) { Remove-Item $path -Force }
    Move-Item -Path $tmp -Destination $path
    return $true
}

function Test-CanvasExists {
    param([string]$Name)
    return (Test-Path (Get-CanvasPath -Name $Name))
}

function Rename-CanvasFile {
    param([string]$From, [string]$To)

    $src = Get-CanvasPath -Name $From
    $dst = Get-CanvasPath -Name $To
    if (-not (Test-Path $src)) { throw "Canvas not found" }
    if ($src -eq $dst) { return $true }
    if (Test-Path $dst) { throw "A canvas with that name already exists" }

    Move-Item -Path $src -Destination $dst
    Write-Log "Canvas: renamed $From to $To"
    return $true
}

function Remove-CanvasFile {
    param([string]$Name)
    $path = Get-CanvasPath -Name $Name
    if (-not (Test-Path $path)) { return $false }
    Remove-Item $path -Force
    Write-Log "Canvas: deleted $Name"
    return $true
}