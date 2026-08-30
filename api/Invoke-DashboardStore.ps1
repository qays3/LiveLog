function Get-DashboardDir {
    $dir = Join-Path $global:WebRoot "Tools\dashboard-pulse"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return $dir
}

function Get-DashboardManifestPath {
    return Join-Path (Get-DashboardDir) "_manifest.json"
}

function Read-DashboardManifest {
    $path     = Get-DashboardManifestPath
    $manifest = @{}
    if (Test-Path $path) {
        try {
            $raw = Get-Content $path -Raw | ConvertFrom-Json
            $raw.PSObject.Properties | ForEach-Object { $manifest[$_.Name] = $_.Value }
        } catch {}
    }
    return $manifest
}

function Save-DashboardManifest {
    param([hashtable]$Manifest)
    $path = Get-DashboardManifestPath
    $tmp  = $path + ".tmp"
    $json = if ($Manifest.Keys.Count -eq 0) { "{}" } else { $Manifest | ConvertTo-Json -Depth 6 }
    [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
    if (Test-Path $path) { Remove-Item $path -Force }
    Move-Item -Path $tmp -Destination $path
}

function Get-SafeDashboardFilename {
    param([string]$Filename)
    if (-not $Filename) { throw "Filename is required" }
    $name = [System.IO.Path]::GetFileName($Filename)
    $name = $name -replace '[\\/:*?"<>|]', '_'
    if (-not $name.ToLower().EndsWith(".json")) { $name = "$name.json" }
    if (-not $name -or $name -eq ".json") { throw "Invalid filename" }
    return $name
}

function Get-DashboardList {
    $manifest = Read-DashboardManifest
    $list = [System.Collections.Generic.List[object]]::new()
    foreach ($key in $manifest.Keys) {
        $m = $manifest[$key]
        $list.Add([ordered]@{
            file        = $key
            description = [string]$m.description
            author      = [string]$m.author
            uploaded_at = [string]$m.uploaded_at
        })
    }
    $sorted = @($list | Sort-Object { $_.uploaded_at } -Descending)
    return ,$sorted
}

function Save-Dashboard {
    param(
        [string]$Filename,
        [string]$Content,
        [string]$Description,
        [string]$Author
    )
    $name = Get-SafeDashboardFilename -Filename $Filename
    $null = $Content | ConvertFrom-Json

    $dir  = Get-DashboardDir
    $path = Join-Path $dir $name
    $tmp  = $path + ".tmp"
    [System.IO.File]::WriteAllText($tmp, $Content, [System.Text.UTF8Encoding]::new($false))
    if (Test-Path $path) { Remove-Item $path -Force }
    Move-Item -Path $tmp -Destination $path

    $uploadedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $manifest = Read-DashboardManifest
    $manifest[$name] = @{
        description = $Description
        author      = $Author
        uploaded_at = $uploadedAt
    }
    Save-DashboardManifest -Manifest $manifest

    return [ordered]@{
        file        = $name
        description = $Description
        author      = $Author
        uploaded_at = $uploadedAt
    }
}

function Remove-Dashboard {
    param([string]$Filename)
    $name    = Get-SafeDashboardFilename -Filename $Filename
    $dir     = Get-DashboardDir
    $path    = Join-Path $dir $name
    $removed = $false

    if (Test-Path $path) {
        Remove-Item $path -Force
        $removed = $true
    }

    $manifest = Read-DashboardManifest
    if ($manifest.ContainsKey($name)) {
        $manifest.Remove($name)
        Save-DashboardManifest -Manifest $manifest
        $removed = $true
    }

    return $removed
}

function Get-DashboardFileContent {
    param([string]$Filename)
    $name = Get-SafeDashboardFilename -Filename $Filename
    $dir  = Get-DashboardDir
    $path = Join-Path $dir $name
    if (-not (Test-Path $path)) { return $null }
    return [System.IO.File]::ReadAllText($path)
}