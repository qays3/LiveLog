function Get-AnalysisBucketOrder {
    $order = @("5m","10m","20m","30m","40m","50m")
    for ($h = 1; $h -le 23; $h++) { $order += "$($h)h" }
    for ($d = 1; $d -le 30; $d++) { $order += "$($d)d" }
    $order += ">30d"
    return $order
}

function Get-AnalysisBucketThresholdMinutes {
    $map = [ordered]@{ "5m" = 5; "10m" = 10; "20m" = 20; "30m" = 30; "40m" = 40; "50m" = 50 }
    for ($h = 1; $h -le 23; $h++) { $map["$($h)h"] = $h * 60 }
    for ($d = 1; $d -le 30; $d++) { $map["$($d)d"] = $d * 1440 }
    $map[">30d"] = 99999999
    return $map
}

function Get-AnalysisGapBucket {
    param([long]$gapMs)
    if ($gapMs -le 0) { return $null }
    $min = [double]$gapMs / 60000.0
    if ($min -gt (30 * 1440)) { return ">30d" }

    $map      = Get-AnalysisBucketThresholdMinutes
    $best     = $null
    $bestDiff = [double]::MaxValue
    foreach ($k in (Get-AnalysisBucketOrder)) {
        if ($k -eq ">30d") { continue }
        $t    = [double]$map[$k]
        $diff = [math]::Abs($min - $t)
        if ($diff -le $bestDiff) { $bestDiff = $diff; $best = $k }
    }
    return $best
}

function Get-AnalysisEmptyBuckets {
    $b = [ordered]@{}
    foreach ($k in (Get-AnalysisBucketOrder)) { $b[$k] = 0 }
    return $b
}

function Convert-AnalysisToJordan {
    param([long]$ms)
    if ($ms -le 0) { return "Never" }
    [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [DateTimeOffset]::FromUnixTimeMilliseconds($ms).UtcDateTime,
        $global:Timezone
    ).ToString("yyyy-MM-dd hh:mm:ss tt")
}

function Get-AnalysisMaxBucket {
    param([object]$buckets)
    $bktOrder = Get-AnalysisBucketOrder
    $minCount = [int]$global:MaxBucketMinCount
    for ($i = $bktOrder.Count - 1; $i -ge 0; $i--) {
        if ($buckets[$bktOrder[$i]] -ge $minCount) { return $bktOrder[$i] }
    }
    for ($i = $bktOrder.Count - 1; $i -ge 0; $i--) {
        if ($buckets[$bktOrder[$i]] -gt 0) { return $bktOrder[$i] }
    }
    return $null
}

function Invoke-ArielSearchOnce {
    param([int]$LogSourceId, [string]$Period)

    $aql = @"
SELECT devicetime AS dev_ms, starttime AS start_ms
FROM events
WHERE logsourceid=$LogSourceId AND qid<>38750074
$Period
"@

    $base    = "https://$($global:QRadarHost)/api/ariel/searches"
    $encoded = [System.Uri]::EscapeDataString($aql)

    $postReq = [System.Net.HttpWebRequest]::Create("$base`?query_expression=$encoded")
    $postReq.Timeout = 120000; $postReq.ReadWriteTimeout = 120000
    $postReq.Method = "POST"
    $postReq.Headers.Add("SEC", $global:AuthHeader["SEC"])
    $postReq.Headers.Add("Version", "14.0")
    $postReq.Accept = "application/json"
    $postReq.ContentLength = 0
    $postResp   = $postReq.GetResponse()
    $postReader = New-Object System.IO.StreamReader($postResp.GetResponseStream())
    $postJson   = $postReader.ReadToEnd()
    $postReader.Close(); $postResp.Close()
    $search   = $postJson | ConvertFrom-Json
    $searchId = $search.search_id
    if (-not $searchId) { throw "No search_id returned from QRadar" }

    $status   = "WAIT"
    $tries    = 0
    $progress = $null
    while ($status -in @("WAIT","EXECUTE","SORTING")) {
        Start-Sleep -Seconds 2
        $tries++
        $statReq = [System.Net.HttpWebRequest]::Create("$base/$searchId")
        $statReq.Timeout = 60000; $statReq.ReadWriteTimeout = 60000
        $statReq.Method = "GET"
        $statReq.Headers.Add("SEC", $global:AuthHeader["SEC"])
        $statReq.Headers.Add("Version", "14.0")
        $statReq.Accept = "application/json"
        try {
            $statResp   = $statReq.GetResponse()
            $statReader = New-Object System.IO.StreamReader($statResp.GetResponseStream())
            $statJson   = $statReader.ReadToEnd()
            $statReader.Close(); $statResp.Close()
        } catch {
            continue
        }
        $statObj  = $statJson | ConvertFrom-Json
        $status   = $statObj.status
        $progress = $statObj.progress
    }

    if ($status -ne "COMPLETED") {
        $detail = ""
        try {
            if ($statObj.error_messages) {
                $detail = ($statObj.error_messages | ForEach-Object { $_.message }) -join "; "
            }
        } catch {}
        Remove-ArielSearch -SearchId $searchId -Base $base
        if ($detail) { throw "Search ended with status: $status -- $detail" }
        throw "Search ended with status: $status"
    }

    $allEvents = [System.Collections.Generic.List[object]]::new()
    $pageSize  = 200000
    $offset    = 0

    while ($true) {
        $last = $offset + $pageSize - 1

        $resReq = [System.Net.HttpWebRequest]::Create("$base/$searchId/results")
        $resReq.Timeout = 1800000; $resReq.ReadWriteTimeout = 1800000
        $resReq.Method = "GET"
        $resReq.Headers.Add("SEC", $global:AuthHeader["SEC"])
        $resReq.Headers.Add("Version", "14.0")
        $resReq.Accept = "application/json"
        $resReq.AddRange("items", $offset, $last)

        $resResp   = $resReq.GetResponse()
        $resReader = New-Object System.IO.StreamReader($resResp.GetResponseStream())
        $resJson   = $resReader.ReadToEnd()
        $resReader.Close(); $resResp.Close()

        $page = ($resJson | ConvertFrom-Json).events
        $pageArr = @($page)
        if ($pageArr.Count -eq 0) { break }

        foreach ($e in $pageArr) { $allEvents.Add($e) }

        if ($pageArr.Count -lt $pageSize) { break }
        $offset += $pageSize
    }

    Remove-ArielSearch -SearchId $searchId -Base $base
    return $allEvents.ToArray()
}

function Remove-ArielSearch {
    param([string]$SearchId, [string]$Base)
    if (-not $SearchId) { return }
    try {
        $delReq = [System.Net.HttpWebRequest]::Create("$Base/$SearchId")
        $delReq.Timeout = 30000; $delReq.ReadWriteTimeout = 30000
        $delReq.Method = "DELETE"
        $delReq.Headers.Add("SEC", $global:AuthHeader["SEC"])
        $delReq.Headers.Add("Version", "14.0")
        $delReq.Accept = "application/json"
        $delResp = $delReq.GetResponse()
        $delResp.Close()
    } catch {}
}

function Invoke-ArielSourceQuery {
    param([int]$LogSourceId, [string]$Period)

    $attempts = 3
    $lastErr  = $null
    for ($a = 1; $a -le $attempts; $a++) {
        try {
            return Invoke-ArielSearchOnce -LogSourceId $LogSourceId -Period $Period
        } catch {
            $lastErr = $_.Exception.Message
            if ($a -lt $attempts) { Start-Sleep -Seconds ([int]([math]::Pow(2, $a) * 3)) }
        }
    }
    throw "QRadar search failed after $attempts attempts: $lastErr"
}

function Invoke-SourceAnalysis {
    param([int]$LogSourceId, [string]$Period)

    $events = Invoke-ArielSourceQuery -LogSourceId $LogSourceId -Period $Period

    $buckets = Get-AnalysisEmptyBuckets
    $days = @("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")
    $dailyBuckets = [ordered]@{}
    foreach ($day in $days) { $dailyBuckets[$day] = Get-AnalysisEmptyBuckets }
    $stops = [System.Collections.Generic.List[object]]::new()

    if (-not $events -or @($events).Count -eq 0) {
        return [ordered]@{
            event_count   = 0
            unique_count  = 0
            analyzed_from = $null
            analyzed_to   = $null
            buckets       = $buckets
            daily_buckets = $dailyBuckets
            stops         = @()
            max_bucket    = $null
        }
    }

    $tsSet = New-Object System.Collections.Generic.HashSet[long]
    foreach ($e in @($events)) {
        $dev = if ($e.dev_ms) { [long]$e.dev_ms } else { 0 }
        $st  = if ($e.start_ms) { [long]$e.start_ms } else { 0 }
        $ts  = if ($st -gt 0) { $st } else { $dev }
        if ($ts -gt 0) { [void]$tsSet.Add($ts) }
    }
    $tsSorted = [long[]]@($tsSet) | Sort-Object

    if ($tsSorted.Count -eq 0) {
        return [ordered]@{
            event_count   = @($events).Count
            unique_count  = 0
            analyzed_from = $null
            analyzed_to   = $null
            buckets       = $buckets
            daily_buckets = $dailyBuckets
            stops         = @()
            max_bucket    = $null
        }
    }

    $analyzedFrom = Convert-AnalysisToJordan -ms $tsSorted[0]
    $analyzedTo   = Convert-AnalysisToJordan -ms $tsSorted[$tsSorted.Count - 1]

    $bucketOrder = Get-AnalysisBucketOrder
    $minCount = [int]$global:MaxBucketMinCount
    if ($minCount -lt 1) { $minCount = 4 }

    $minStopIdx = $bucketOrder.IndexOf("20m")
    $seenCounts   = @{}
    $storedCounts = @{}
    foreach ($bk in $bucketOrder) { $seenCounts[$bk] = 0; $storedCounts[$bk] = 0 }
    $maxLockIdx = -1

    for ($i = 1; $i -lt $tsSorted.Count; $i++) {
        $gapMs = $tsSorted[$i] - $tsSorted[$i - 1]
        if ($gapMs -le 0) { continue }
        $gapBucket = Get-AnalysisGapBucket -gapMs $gapMs
        if (-not $gapBucket) { continue }

        $buckets[$gapBucket]++

        $gapDayUtc   = [DateTimeOffset]::FromUnixTimeMilliseconds($tsSorted[$i - 1]).UtcDateTime
        $gapDayLocal = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($gapDayUtc, $global:Timezone)
        $dayName     = $gapDayLocal.DayOfWeek.ToString()
        $dailyBuckets[$dayName][$gapBucket]++

        $gapIdx = $bucketOrder.IndexOf($gapBucket)
        if ($gapIdx -lt $minStopIdx) { continue }

        $seenCounts[$gapBucket]++
        if ($seenCounts[$gapBucket] -ge $minCount -and $gapIdx -gt $maxLockIdx) {
            $maxLockIdx = $gapIdx
        }

        $doStore = $false
        if ($maxLockIdx -lt 0) {
            $doStore = $true
        } elseif ($gapIdx -ge $maxLockIdx -and $storedCounts[$gapBucket] -lt $minCount) {
            $doStore = $true
        }

        if ($doStore) {
            $storedCounts[$gapBucket]++
            $stops.Add([ordered]@{
                start_ms   = $tsSorted[$i - 1]
                end_ms     = $tsSorted[$i]
                gap_ms     = $gapMs
                bucket     = $gapBucket
                day        = $dayName
                started_at = (Convert-AnalysisToJordan -ms $tsSorted[$i - 1])
                ended_at   = (Convert-AnalysisToJordan -ms $tsSorted[$i])
            })
        }
    }

    $maxBkt = Get-AnalysisMaxBucket -buckets $buckets

    $stopsOut = @($stops)

    return [ordered]@{
        event_count   = @($events).Count
        unique_count  = $tsSorted.Count
        analyzed_from = $analyzedFrom
        analyzed_to   = $analyzedTo
        buckets       = $buckets
        daily_buckets = $dailyBuckets
        stops         = $stopsOut
        max_bucket    = $maxBkt
    }
}

function Set-SourceProp {
    param([object]$Source, [string]$Name, $Value)
    $Source | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Write-AnalysisOverwrite {
    param([int]$LogSourceId, [object]$Analysis)

    $stage = "init"
    try {
        $srcIdStr   = [string]$LogSourceId
        $targetFile = $null
        $targetData = $null

        $stage = "locate-file"
        foreach ($f in (Get-ChildItem -Path $global:DomainsDir -Filter "*.json" -Recurse -ErrorAction SilentlyContinue)) {
            try {
                $content = Get-Content $f.FullName -Raw | ConvertFrom-Json
                if ($content.log_sources) {
                    $srcArr = @($content.log_sources)
                    foreach ($s in $srcArr) {
                        if ([string]$s.id -eq $srcIdStr) { $targetFile = $f.FullName; $targetData = $content; break }
                    }
                }
            } catch {}
            if ($targetFile) { break }
        }

        if (-not $targetFile) { throw "Log source $LogSourceId not found in any collector file" }

        $stage = "mutate-sources"
        $srcArr  = @($targetData.log_sources)
        $matched = $false
        $newArr  = New-Object System.Collections.ArrayList
        foreach ($s in $srcArr) {
            if ([string]$s.id -eq $srcIdStr) {
                Set-SourceProp -Source $s -Name 'buckets'        -Value $Analysis.buckets
                Set-SourceProp -Source $s -Name 'daily_buckets'  -Value $Analysis.daily_buckets
                Set-SourceProp -Source $s -Name 'analyzed_from'  -Value $Analysis.analyzed_from
                Set-SourceProp -Source $s -Name 'analyzed_to'    -Value $Analysis.analyzed_to
                if ($Analysis.max_bucket) { Set-SourceProp -Source $s -Name 'current_bucket' -Value $Analysis.max_bucket }
                $matched = $true
            }
            [void]$newArr.Add($s)
        }

        if (-not $matched) { throw "Source $LogSourceId vanished from file before write" }

        $stage = "build-rebuilt"
        $sourcesArray = $newArr.ToArray()
        $rebuilt = [ordered]@{}
        $rebuilt["collector_name"] = [string]$targetData.collector_name
        $rebuilt["domain_group"]   = [string]$targetData.domain_group
        $rebuilt["last_updated"]   = [string]$targetData.last_updated
        $rebuilt["log_sources"]    = $sourcesArray

        $stage = "write-collector"
        $tmp = $targetFile + ".tmp"
        $rebuilt | ConvertTo-Json -Depth 12 | Set-Content -Path $tmp -Encoding UTF8
        if (Test-Path $targetFile) { Remove-Item $targetFile -Force }
        Move-Item -Path $tmp -Destination $targetFile

        $stage = "read-stops"
        $stopsFile = Join-Path $global:DataDir "stops.json"
        $allStops  = [ordered]@{}
        if (Test-Path $stopsFile) {
            try {
                $raw = Get-Content $stopsFile -Raw | ConvertFrom-Json
                foreach ($p in $raw.PSObject.Properties) {
                    $allStops[[string]$p.Name] = @($p.Value)
                }
            } catch {}
        }

        $stage = "build-stops"
        $stopArr = @()
        foreach ($item in @($Analysis.stops)) { if ($null -ne $item) { $stopArr += $item } }
        $allStops[$srcIdStr] = $stopArr

        $stage = "write-stops"
        $tmpStops = $stopsFile + ".tmp"
        $allStops | ConvertTo-Json -Depth 6 | Set-Content -Path $tmpStops -Encoding UTF8
        if (Test-Path $stopsFile) { Remove-Item $stopsFile -Force }
        Move-Item -Path $tmpStops -Destination $stopsFile

        $stage = "verify"
        $verify = Get-Content $targetFile -Raw | ConvertFrom-Json
        $vsrc   = @($verify.log_sources) | Where-Object { [string]$_.id -eq $srcIdStr } | Select-Object -First 1
        $totalGaps = 0
        if ($vsrc -and $vsrc.buckets) {
            foreach ($bp in $vsrc.buckets.PSObject.Properties) { $totalGaps += [int]$bp.Value }
        }

        return [ordered]@{
            file          = [string]$targetFile
            total_gaps    = $totalGaps
            stops_written = @($Analysis.stops).Count
        }
    } catch {
        throw "Overwrite failed at stage [$stage]: $($_.Exception.Message)"
    }
}
function Reset-SourceBuckets {
    param([int]$LogSourceId)

    $stage = "init"
    try {
        $srcIdStr   = [string]$LogSourceId
        $targetFile = $null
        $targetData = $null

        $stage = "locate-file"
        foreach ($f in (Get-ChildItem -Path $global:DomainsDir -Filter "*.json" -Recurse -ErrorAction SilentlyContinue)) {
            try {
                $content = Get-Content $f.FullName -Raw | ConvertFrom-Json
                if ($content.log_sources) {
                    foreach ($s in @($content.log_sources)) {
                        if ([string]$s.id -eq $srcIdStr) { $targetFile = $f.FullName; $targetData = $content; break }
                    }
                }
            } catch {}
            if ($targetFile) { break }
        }

        if (-not $targetFile) { throw "Log source $LogSourceId not found in any collector file" }

        $stage = "build-empty"
        $emptyBuckets = Get-AnalysisEmptyBuckets
        $days = @("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")
        $emptyDaily = [ordered]@{}
        foreach ($day in $days) { $emptyDaily[$day] = Get-AnalysisEmptyBuckets }

        $stage = "mutate-sources"
        $newArr  = New-Object System.Collections.ArrayList
        $matched = $false
        foreach ($s in @($targetData.log_sources)) {
            if ([string]$s.id -eq $srcIdStr) {
                Set-SourceProp -Source $s -Name 'buckets'        -Value $emptyBuckets
                Set-SourceProp -Source $s -Name 'daily_buckets'  -Value $emptyDaily
                Set-SourceProp -Source $s -Name 'analyzed_from'  -Value $null
                Set-SourceProp -Source $s -Name 'analyzed_to'    -Value $null
                $matched = $true
            }
            [void]$newArr.Add($s)
        }
        if (-not $matched) { throw "Source $LogSourceId vanished from file before write" }

        $stage = "write-collector"
        $rebuilt = [ordered]@{}
        $rebuilt["collector_name"] = [string]$targetData.collector_name
        $rebuilt["domain_group"]   = [string]$targetData.domain_group
        $rebuilt["last_updated"]   = [string]$targetData.last_updated
        $rebuilt["log_sources"]    = $newArr.ToArray()

        $tmp = $targetFile + ".tmp"
        $rebuilt | ConvertTo-Json -Depth 12 | Set-Content -Path $tmp -Encoding UTF8
        if (Test-Path $targetFile) { Remove-Item $targetFile -Force }
        Move-Item -Path $tmp -Destination $targetFile

        $stage = "reset-stops"
        $stopsFile = Join-Path $global:DataDir "stops.json"
        if (Test-Path $stopsFile) {
            $allStops = [ordered]@{}
            try {
                $raw = Get-Content $stopsFile -Raw | ConvertFrom-Json
                foreach ($p in $raw.PSObject.Properties) {
                    if ([string]$p.Name -ne $srcIdStr) { $allStops[[string]$p.Name] = @($p.Value) }
                }
            } catch {}
            $tmpStops = $stopsFile + ".tmp"
            $allStops | ConvertTo-Json -Depth 6 | Set-Content -Path $tmpStops -Encoding UTF8
            if (Test-Path $stopsFile) { Remove-Item $stopsFile -Force }
            Move-Item -Path $tmpStops -Destination $stopsFile
        }

        $stage = "reset-overrides"
        return [ordered]@{ file = [string]$targetFile }
    } catch {
        throw "Reset failed at stage [$stage]: $($_.Exception.Message)"
    }
}