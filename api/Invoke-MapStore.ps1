function Get-MapDir {
    $dir = Join-Path $global:WebRoot "map"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return $dir
}

function Get-MapSafeName {
    param([string]$Domain)
    $name = [string]$Domain
    foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) {
        $name = $name.Replace([string]$c, "_")
    }
    $name = $name -replace '[\\/:*?"<>|]', '_'
    $name = $name.Trim()
    if ([string]::IsNullOrWhiteSpace($name)) { throw "Invalid domain name" }
    return $name
}

function Get-MapPath {
    param([string]$Domain)
    $safe = Get-MapSafeName -Domain $Domain
    return (Join-Path (Get-MapDir) "$safe.json")
}

function Read-MapFile {
    param([string]$Domain)
    $path = Get-MapPath -Domain $Domain
    if (-not (Test-Path $path)) { return $null }
    return [System.IO.File]::ReadAllText($path)
}

function Write-MapFile {
    param([string]$Domain, [string]$Json)
    $null = $Json | ConvertFrom-Json
    $path = Get-MapPath -Domain $Domain
    $tmp  = $path + ".tmp"
    [System.IO.File]::WriteAllText($tmp, $Json, [System.Text.UTF8Encoding]::new($false))
    if (Test-Path $path) { Remove-Item $path -Force }
    Move-Item -Path $tmp -Destination $path
    return $true
}

function Remove-MapFile {
    param([string]$Domain)
    $path = Get-MapPath -Domain $Domain
    if (Test-Path $path) { Remove-Item $path -Force; return $true }
    return $false
}

function Get-MapList {
    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($f in (Get-ChildItem -Path (Get-MapDir) -Filter "*.json" -ErrorAction SilentlyContinue)) {
        $domain    = $null
        $generated = $null
        $sources   = 0
        try {
            $data      = Get-Content $f.FullName -Raw | ConvertFrom-Json
            $domain    = [string]$data.domain
            $generated = [string]$data.generated_at
            $sources   = [int]$data.total_sources
        } catch {}
        if ([string]::IsNullOrWhiteSpace($domain)) { $domain = $f.BaseName }
        $out.Add([ordered]@{
            domain        = $domain
            generated_at  = $generated
            total_sources = $sources
            file          = $f.Name
        })
    }
    return $out.ToArray()
}