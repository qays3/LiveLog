function Get-ToolSafeName {
    param([string]$Name)
    $n = [string]$Name
    if ($n -notmatch '^[A-Za-z0-9._-]{1,64}$') { throw "Invalid tool or version name" }
    if ($n -match '\.\.') { throw "Invalid tool or version name" }
    return $n
}

function Get-ToolSafeFileName {
    param([string]$Name)
    $n = [System.IO.Path]::GetFileName([string]$Name)
    foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) {
        $n = $n.Replace([string]$c, "_")
    }
    $n = ($n -replace '[\\/:*?"<>|]', '_').Trim()
    if ([string]::IsNullOrWhiteSpace($n)) { $n = "upload.txt" }
    if ($n.Length -gt 120) { $n = $n.Substring(0, 120) }
    return $n
}

function Get-ToolDir {
    param([string]$Tool)
    $safe = Get-ToolSafeName -Name $Tool
    $dir  = Join-Path (Join-Path $global:WebRoot "Tools") $safe
    $ver  = Join-Path $dir "versions"
    if (-not (Test-Path $ver)) { New-Item -ItemType Directory -Path $ver -Force | Out-Null }
    return $dir
}

function Get-ToolVersionsDir {
    param([string]$Tool)
    return (Join-Path (Get-ToolDir -Tool $Tool) "versions")
}

function Get-ToolMetaPath {
    param([string]$Tool)
    return (Join-Path (Get-ToolDir -Tool $Tool) "meta.json")
}

function Read-ToolMeta {
    param([string]$Tool)
    $path = Get-ToolMetaPath -Tool $Tool
    if (-not (Test-Path $path)) { return @() }
    try {
        $data = Get-Content $path -Raw | ConvertFrom-Json
        return @($data.versions)
    } catch {
        return @()
    }
}

function ConvertTo-ToolJsonString {
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

function Write-ToolMeta {
    param([string]$Tool, $Versions)

    $path = Get-ToolMetaPath -Tool $Tool
    $dir  = Get-ToolVersionsDir -Tool $Tool

    $rows = New-Object System.Collections.Generic.List[string]
    foreach ($v in @($Versions)) {
        if ($null -eq $v) { continue }
        $ver = [string]$v.version
        if ([string]::IsNullOrWhiteSpace($ver)) { continue }

        $stored = [string]$v.stored
        if ($stored -and -not (Test-Path (Join-Path $dir $stored))) { continue }

        $sb = New-Object System.Text.StringBuilder
        [void]$sb.Append('    {"version":')
        [void]$sb.Append((ConvertTo-ToolJsonString $ver))
        [void]$sb.Append(',"file_name":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.file_name)))
        [void]$sb.Append(',"stored":')
        [void]$sb.Append((ConvertTo-ToolJsonString $stored))
        [void]$sb.Append(',"author":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.author)))
        [void]$sb.Append(',"notes":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.notes)))
        [void]$sb.Append(',"uploaded_at":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.uploaded_at)))
        [void]$sb.Append(',"size":')
        [void]$sb.Append([int64]$v.size)
        [void]$sb.Append('}')
        $rows.Add($sb.ToString())
    }

    $json = New-Object System.Text.StringBuilder
    [void]$json.Append('{' + [Environment]::NewLine)
    [void]$json.Append('  "tool": ' + (ConvertTo-ToolJsonString $Tool) + ',' + [Environment]::NewLine)
    [void]$json.Append('  "updated_at": ' + (ConvertTo-ToolJsonString (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) + ',' + [Environment]::NewLine)
    if ($rows.Count -eq 0) {
        [void]$json.Append('  "versions": []' + [Environment]::NewLine)
    } else {
        [void]$json.Append('  "versions": [' + [Environment]::NewLine)
        [void]$json.Append(($rows -join ("," + [Environment]::NewLine)))
        [void]$json.Append([Environment]::NewLine + '  ]' + [Environment]::NewLine)
    }
    [void]$json.Append('}')

    $tmp = $path + ".tmp"
    [System.IO.File]::WriteAllText($tmp, $json.ToString(), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -Path $tmp -Destination $path -Force
    return $rows.Count
}

function Get-ToolVersionList {
    param([string]$Tool)

    $dir   = Get-ToolVersionsDir -Tool $Tool
    $meta  = @(Read-ToolMeta -Tool $Tool)
    $byKey = @{}
    foreach ($m in $meta) {
        if ($m -and $m.stored) { $byKey[[string]$m.stored] = $m }
    }

    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($f in (Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)) {
        $rec = $byKey[$f.Name]
        if ($rec) {
            $out.Add([ordered]@{
                version     = [string]$rec.version
                file_name   = [string]$rec.file_name
                stored      = $f.Name
                author      = [string]$rec.author
                notes       = [string]$rec.notes
                uploaded_at = [string]$rec.uploaded_at
                size        = $f.Length
            })
        } else {
            $out.Add([ordered]@{
                version     = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
                file_name   = $f.Name
                stored      = $f.Name
                author      = "unknown"
                notes       = "Added directly to the versions folder"
                uploaded_at = $f.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                size        = $f.Length
            })
        }
    }

    return $out.ToArray()
}

function Get-ToolVersionsJson {
    param([string]$Tool)

    $rows = New-Object System.Collections.Generic.List[string]
    foreach ($v in @(Get-ToolVersionList -Tool $Tool)) {
        if ($null -eq $v) { continue }
        $sb = New-Object System.Text.StringBuilder
        [void]$sb.Append('{"version":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.version)))
        [void]$sb.Append(',"file_name":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.file_name)))
        [void]$sb.Append(',"stored":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.stored)))
        [void]$sb.Append(',"author":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.author)))
        [void]$sb.Append(',"notes":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.notes)))
        [void]$sb.Append(',"uploaded_at":')
        [void]$sb.Append((ConvertTo-ToolJsonString ([string]$v.uploaded_at)))
        [void]$sb.Append(',"size":')
        [void]$sb.Append([int64]$v.size)
        [void]$sb.Append('}')
        $rows.Add($sb.ToString())
    }

    return '[' + ($rows -join ',') + ']'
}

function Get-ToolNextVersion {
    param([string]$Tool)
    $max = 0
    foreach ($v in (Get-ToolVersionList -Tool $Tool)) {
        if ([string]$v.version -match '(\d+)') {
            $n = [int]$Matches[1]
            if ($n -gt $max) { $max = $n }
        }
    }
    return "v" + ($max + 1)
}

function Add-ToolVersion {
    param([string]$Tool, [string]$FileName, [string]$Author, [string]$Notes, [string]$Version, [string]$ContentBase64)

    if ([string]::IsNullOrWhiteSpace($ContentBase64)) { throw "No file content received" }
    if ([string]::IsNullOrWhiteSpace($Author))        { throw "Author is required" }

    $bytes = [System.Convert]::FromBase64String($ContentBase64)
    if ($bytes.Length -eq 0)          { throw "Uploaded file is empty" }
    if ($bytes.Length -gt 20971520)   { throw "Uploaded file is larger than 20 MB" }

    $safeFile = Get-ToolSafeFileName -Name $FileName
    $ver      = if ([string]::IsNullOrWhiteSpace($Version)) { Get-ToolNextVersion -Tool $Tool } else { Get-ToolSafeName -Name $Version }

    foreach ($existing in (Get-ToolVersionList -Tool $Tool)) {
        if ([string]$existing.version -eq $ver) { throw "Version $ver already exists" }
    }

    $stored = "$ver`__$safeFile"
    $path   = Join-Path (Get-ToolVersionsDir -Tool $Tool) $stored
    [System.IO.File]::WriteAllBytes($path, $bytes)

    $meta = @(Read-ToolMeta -Tool $Tool)
    $rec  = [ordered]@{
        version     = $ver
        file_name   = $safeFile
        stored      = $stored
        author      = ([string]$Author).Trim()
        notes       = ([string]$Notes).Trim()
        uploaded_at = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        size        = $bytes.Length
    }
    Write-ToolMeta -Tool $Tool -Versions (@($meta) + @($rec)) | Out-Null

    Write-Log "Toolbox: $Tool version $ver uploaded by $Author ($($bytes.Length) bytes)"
    return $rec
}

function Get-ToolVersionPath {
    param([string]$Tool, [string]$Version)

    $list = @(Get-ToolVersionList -Tool $Tool)
    if ($list.Count -eq 0) { return $null }

    $rec = $null
    if ([string]::IsNullOrWhiteSpace($Version) -or $Version -eq "latest") {
        $rec = $list[$list.Count - 1]
    } else {
        $safe = Get-ToolSafeName -Name $Version
        foreach ($v in $list) { if ([string]$v.version -eq $safe) { $rec = $v; break } }
    }
    if (-not $rec) { return $null }

    $path = Join-Path (Get-ToolVersionsDir -Tool $Tool) ([string]$rec.stored)
    if (-not (Test-Path $path)) { return $null }
    return [ordered]@{ path = $path; file_name = [string]$rec.file_name; version = [string]$rec.version }
}

function Remove-ToolVersion {
    param([string]$Tool, [string]$Version)

    $safe = Get-ToolSafeName -Name $Version
    $dir  = Get-ToolVersionsDir -Tool $Tool

    $rec = $null
    foreach ($v in @(Get-ToolVersionList -Tool $Tool)) {
        if ([string]$v.version -eq $safe) { $rec = $v; break }
    }
    if (-not $rec) { return $false }

    $stored = [string]$rec.stored
    if ($stored) {
        $path = Join-Path $dir $stored
        if (Test-Path $path) { Remove-Item $path -Force -ErrorAction SilentlyContinue }
    }

    foreach ($stray in (Get-ChildItem -Path $dir -File -Filter "$safe`__*" -ErrorAction SilentlyContinue)) {
        Remove-Item $stray.FullName -Force -ErrorAction SilentlyContinue
    }

    $kept = New-Object System.Collections.Generic.List[object]
    foreach ($m in @(Read-ToolMeta -Tool $Tool)) {
        if ($null -eq $m) { continue }
        if ([string]$m.version -eq $safe) { continue }
        $kept.Add($m)
    }

    $remaining = Write-ToolMeta -Tool $Tool -Versions $kept
    Write-Log "Toolbox: $Tool version $safe deleted, $remaining version(s) remain in meta.json"
    return $true
}