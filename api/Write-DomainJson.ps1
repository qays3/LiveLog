if (-not (Get-Command Write-Log -ErrorAction SilentlyContinue)) {
    function Write-Log {
        param([Parameter(Position=0)][string]$Message,[ValidateSet("INFO","WARN","ERROR")][string]$Level="INFO")
        $logFile = if ($global:LogFile) { $global:LogFile } else { Join-Path (Split-Path -Parent $PSCommandPath) "..\log\livelog.log" }
        try {
            $dir = Split-Path -Parent $logFile
            if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Add-Content -Path $logFile -Value ("{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message) -Encoding UTF8
        } catch {}
    }
}

function Save-JsonAtomic {
    param(
        [Parameter(Mandatory)][string]$Json,
        [Parameter(Mandatory)][string]$Path
    )
    $tempPath = $Path + ".tmp"
    try {
        Set-Content -Path $tempPath -Value $Json -Encoding UTF8 -ErrorAction Stop

        $written = (Get-Item -Path $tempPath -ErrorAction Stop).Length
        if ($written -le 0) {
            Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
            Write-Log "Save-JsonAtomic: temp write produced empty file, keeping existing '$Path'" -Level ERROR
            return $false
        }

        Move-Item -Path $tempPath -Destination $Path -Force -ErrorAction Stop
        return $true
    } catch {
        if (Test-Path $tempPath) { Remove-Item $tempPath -Force -ErrorAction SilentlyContinue }
        Write-Log "Save-JsonAtomic failed for '$Path' (existing file preserved): $($_.Exception.Message)" -Level ERROR
        return $false
    }
}

function Get-BucketOrder {
    $order = @("5m","10m","20m","30m","40m","50m")
    for ($h = 1; $h -le 23; $h++) { $order += "$($h)h" }
    for ($d = 1; $d -le 30; $d++) { $order += "$($d)d" }
    $order += ">30d"
    return $order
}

function Get-BucketThresholdMinutes {
    $map = [ordered]@{ "5m" = 5; "10m" = 10; "20m" = 20; "30m" = 30; "40m" = 40; "50m" = 50 }
    for ($h = 1; $h -le 23; $h++) { $map["$($h)h"] = $h * 60 }
    for ($d = 1; $d -le 30; $d++) { $map["$($d)d"] = $d * 1440 }
    $map[">30d"] = 99999999
    return $map
}

function Get-BucketFromMs {
    param([long]$ms)
    if ($ms -le 0) { return $null }
    $min = [double]$ms / 60000.0
    if ($min -gt (30 * 1440)) { return ">30d" }

    $map      = Get-BucketThresholdMinutes
    $best     = $null
    $bestDiff = [double]::MaxValue
    foreach ($k in (Get-BucketOrder)) {
        if ($k -eq ">30d") { continue }
        $t    = [double]$map[$k]
        $diff = [math]::Abs($min - $t)
        if ($diff -le $bestDiff) { $bestDiff = $diff; $best = $k }
    }
    return $best
}

function Get-LegacyBucketMinutes {
    return @{
        "5min" = 5; "10min" = 10; "15min" = 15; "20min" = 20; "30min" = 30
        "1hr"  = 60; "2hr" = 120; "4hr" = 240; "8hr" = 480; "12hr" = 720
    }
}

function ConvertTo-NewBuckets {
    param($ExistingBuckets)

    $out = Get-EmptyBuckets
    if (-not $ExistingBuckets) { return $out }

    $legacy = Get-LegacyBucketMinutes

    foreach ($p in $ExistingBuckets.PSObject.Properties) {
        $key = [string]$p.Name
        $val = 0
        try { $val = [int]$p.Value } catch { $val = 0 }
        if ($val -le 0) { continue }

        if ($out.Contains($key)) {
            $out[$key] = [int]$out[$key] + $val
        }
        elseif ($legacy.ContainsKey($key)) {
            $nk = Get-BucketFromMs -ms ([long]$legacy[$key] * 60000)
            if ($nk -and $out.Contains($nk)) {
                $out[$nk] = [int]$out[$nk] + $val
            }
        }
    }
    return $out
}

function Get-CurrentBucket {
    param([long]$lastEventMs)
    if ($lastEventMs -le 0) { return ">30d" }
    $diffMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $lastEventMs
    $b = Get-BucketFromMs -ms $diffMs
    if (-not $b) { return "5m" }
    return $b
}

function Get-GapBucket {
    param([long]$gapMs)
    return Get-BucketFromMs -ms $gapMs
}

function Convert-ToJordan {
    param([long]$ms)
    if ($ms -le 0) { return "Never" }
    [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [DateTimeOffset]::FromUnixTimeMilliseconds($ms).UtcDateTime,
        $global:Timezone
    ).ToString("yyyy-MM-dd hh:mm:ss tt")
}

function Get-BehaviorThresholds {
    param([object]$buckets)
    $order   = Get-BucketOrder
    $minCount = [int]$global:MaxBucketMinCount
    $nonZero = @()
    foreach ($bk in $order) {
        $val = 0
        if ($buckets -and $buckets.PSObject.Properties[$bk]) { $val = [int]$buckets.$bk }
        if ($val -gt 0) { $nonZero += $bk }
    }
    if ($nonZero.Count -eq 0) { return @{ warn = $null; alarm = $null } }

    $alarmBucket = $null
    for ($i = $order.Count - 1; $i -ge 0; $i--) {
        $bk  = $order[$i]
        $val = 0
        if ($buckets -and $buckets.PSObject.Properties[$bk]) { $val = [int]$buckets.$bk }
        if ($val -ge $minCount) { $alarmBucket = $bk; break }
    }
    if (-not $alarmBucket) { $alarmBucket = $nonZero[$nonZero.Count - 1] }

    if ($nonZero.Count -eq 1) { return @{ warn = $nonZero[0]; alarm = $alarmBucket } }
    $warnBucket = $nonZero[0]
    $biggestGap = 0
    for ($i = 0; $i -lt $nonZero.Count - 1; $i++) {
        $idxA = [array]::IndexOf($order, $nonZero[$i])
        $idxB = [array]::IndexOf($order, $nonZero[$i + 1])
        $gap  = $idxB - $idxA
        if ($gap -gt $biggestGap) { $biggestGap = $gap; $warnBucket = $nonZero[$i] }
    }
    return @{ warn = $warnBucket; alarm = $alarmBucket }
}

function Get-EmptyBuckets {
    $b = [ordered]@{}
    foreach ($k in (Get-BucketOrder)) { $b[$k] = 0 }
    return $b
}

function Get-DowntimeSetting {
    param([string]$Name, $Default)
    $var = Get-Variable -Name $Name -Scope Global -ErrorAction SilentlyContinue
    if ($null -eq $var) { return $Default }
    $val = $var.Value
    if ($null -eq $val) { return $Default }
    if ($val -is [string] -and $val.Trim() -eq "") { return $Default }
    return $val
}

function Get-SourceAlarmThresholdMinutes {
    param($ExistingSource, $OverrideMs)

    if ($null -ne $OverrideMs -and [long]$OverrideMs -gt 0) {
        return [double]([long]$OverrideMs / 60000)
    }
    if (-not $ExistingSource -or -not $ExistingSource.buckets) { return $null }

    $order    = Get-BucketOrder
    $minCount = [int](Get-DowntimeSetting -Name "MaxBucketMinCount" -Default 4)
    if ($minCount -lt 1) { $minCount = 4 }

    $maxBkt = $null
    for ($i = $order.Count - 1; $i -ge 0; $i--) {
        $bk = $order[$i]
        if ($ExistingSource.buckets.PSObject.Properties[$bk] -and [int]$ExistingSource.buckets.$bk -ge $minCount) { $maxBkt = $bk; break }
    }
    if (-not $maxBkt) {
        for ($i = $order.Count - 1; $i -ge 0; $i--) {
            $bk = $order[$i]
            if ($ExistingSource.buckets.PSObject.Properties[$bk] -and [int]$ExistingSource.buckets.$bk -gt 0) { $maxBkt = $bk; break }
        }
    }
    if (-not $maxBkt) { return $null }

    $map = Get-BucketThresholdMinutes
    return [double]$map[$maxBkt]
}

function Test-GapWasAbnormal {
    param($ExistingSource, [long]$PrevMs, [long]$NewMs, $OverrideMs)

    $thresh = Get-SourceAlarmThresholdMinutes -ExistingSource $ExistingSource -OverrideMs $OverrideMs
    if ($null -eq $thresh) { return $false }

    $bufferMin  = [double](Get-DowntimeSetting -Name "AlertBufferMin" -Default 0)
    $silenceMin = if ($PrevMs -gt 0) { ($NewMs - $PrevMs) / 60000 } else { 0 }
    return ($silenceMin -gt ($thresh + $bufferMin))
}

function Get-SuppressedGapSourceIds {
    param($Gaps)

    $result = @{}
    $all    = @($Gaps)
    if ($all.Count -eq 0) { return $result }
    if ((Get-DowntimeSetting -Name "DowntimeGuardEnabled" -Default $true) -eq $false) { return $result }

    $downEnd = [long](Get-DowntimeSetting -Name "DowntimeEndMs" -Default 0)
    if ((Get-DowntimeSetting -Name "SuppressDowntimeGaps" -Default $false) -eq $true -and $downEnd -gt 0) {
        foreach ($g in $all) {
            if ([long]$g.prev_ms -lt $downEnd) { $result[[string]$g.src_id] = "poller downtime" }
        }
    }

    $minSources    = [int](Get-DowntimeSetting -Name "MassGapMinSources"    -Default 5)
    $minCollectors = [int](Get-DowntimeSetting -Name "MassGapMinCollectors" -Default 2)
    $windowMin     = [int](Get-DowntimeSetting -Name "MassGapWindowMin"     -Default 15)
    if ($minSources    -lt 2) { $minSources    = 2 }
    if ($minCollectors -lt 1) { $minCollectors = 1 }
    if ($windowMin     -lt 1) { $windowMin     = 1 }

    $candidates = @($all | Where-Object { $_.was_alarm })
    if ($candidates.Count -lt $minSources) { return $result }

    $windowMs = [long]$windowMin * 60000
    foreach ($anchor in $candidates) {
        $cluster = @($candidates | Where-Object { [math]::Abs([long]$_.prev_ms - [long]$anchor.prev_ms) -le $windowMs })
        if ($cluster.Count -lt $minSources) { continue }
        $collectors = @($cluster | ForEach-Object { [string]$_.collector } | Sort-Object -Unique)
        if ($collectors.Count -lt $minCollectors) { continue }
        foreach ($c in $cluster) {
            $cid = [string]$c.src_id
            if (-not $result.ContainsKey($cid)) { $result[$cid] = "simultaneous outage across collectors" }
        }
    }

    return $result
}

$script:WriteDomainJsonFileCache = @{}

function Get-CachedDomainFile {
    param([string]$FilePath)
    if ($script:WriteDomainJsonFileCache.ContainsKey($FilePath)) {
        return $script:WriteDomainJsonFileCache[$FilePath]
    }
    $arr  = @()
    $byId = @{}
    if (Test-Path $FilePath) {
        try {
            $parsed = Get-Content $FilePath -Raw | ConvertFrom-Json
            if ($parsed.log_sources) {
                $arr = @($parsed.log_sources)
                foreach ($e in $arr) { $byId[[string]$e.id] = $e }
            }
        } catch {}
    }
    $result = @{ Array = $arr; ById = $byId }
    $script:WriteDomainJsonFileCache[$FilePath] = $result
    return $result
}

function Write-DomainJson {
    param(
        [array]$LogSources,
        [hashtable]$Collectors,
        [hashtable]$Groups,
        [hashtable]$Types
    )

    $script:WriteDomainJsonFileCache = @{}

    $now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [DateTime]::SpecifyKind([DateTime]::UtcNow, [System.DateTimeKind]::Utc), $global:Timezone
    ).ToString("yyyy-MM-dd hh:mm:ss tt")

    $pendingGaps = [System.Collections.Generic.List[object]]::new()
    $grouped = @{}
    $ignoredGroupIds = [System.Collections.Generic.HashSet[string]]::new()

    $overridesFile = Join-Path $global:DataDir "overrides.json"
    $overridesData = $null
    if (Test-Path $overridesFile) {
        try { $overridesData = Get-Content $overridesFile -Raw | ConvertFrom-Json } catch {}
    }

    $stopsFile = Join-Path $global:DataDir "stops.json"
    $allStops  = @{}
    if (Test-Path $stopsFile) {
        try {
            $raw = Get-Content $stopsFile -Raw | ConvertFrom-Json
            $raw.PSObject.Properties | ForEach-Object { $allStops[$_.Name] = [System.Collections.Generic.List[object]]($_.Value) }
        } catch {}
    }
    foreach ($k in @($allStops.Keys)) {
        $kept = [System.Collections.Generic.List[object]]::new()
        foreach ($st in $allStops[$k]) {
            $sb = $null
            if ($st -is [System.Collections.IDictionary]) { $sb = $st["bucket"] }
            elseif ($st.PSObject.Properties["bucket"])      { $sb = $st.bucket }
            if ([string]$sb -ne "5m") { $kept.Add($st) }
        }
        $allStops[$k] = $kept
    }
    $stopsDirty = $false

    foreach ($src in $LogSources) {
        try {
            $collectorName = if ($src.target_event_collector_id -ne $null) { $Collectors[[int]$src.target_event_collector_id] } else { "Unknown" }
            if ($collectorName -eq "eventcollector0 :: QConsole") { continue }

            $allGroupNames = if ($src.group_ids) {
                $src.group_ids | ForEach-Object { $Groups[[int]$_] } | Where-Object { $_ }
            } else { @() }

            $domainGroup = ($allGroupNames | Where-Object { $global:DomainList -contains $_ } | Select-Object -First 1)
            if (-not $domainGroup -and $global:CollectorDomainMap.ContainsKey($collectorName)) {
                $domainGroup = $global:CollectorDomainMap[$collectorName]
            }
            if (-not $domainGroup) { continue }
            if ($collectorName -eq "Unknown") { continue }

            if ($global:IgnoreCollectors -contains $collectorName) { continue }
            if ($global:IgnoreSourceIds -contains [int]$src.id) { continue }
            $srcType = $Types[[int]$src.type_id]
            if ($global:IgnoreTypes -and $srcType -and ($global:IgnoreTypes | Where-Object { $srcType -like "*$_*" })) { continue }
            $isIgnoredGroup = $false
            foreach ($grpName in $allGroupNames) {
                if ($global:IgnoreGroups -contains $grpName) { $isIgnoredGroup = $true; break }
            }
            if ($isIgnoredGroup) { $ignoredGroupIds.Add([string]$src.id) | Out-Null; continue }
            if ($global:IgnoreNamePatterns) {
                $isIgnoredName = $false
                foreach ($pat in $global:IgnoreNamePatterns) {
                    if ($src.name -like "*$pat*") { $isIgnoredName = $true; break }
                }
                if ($isIgnoredName) { continue }
            }

            $domainSafe    = $domainGroup   -replace '[\\/:*?"<>|]', '_'
            $collectorSafe = $collectorName -replace '[\\/:*?"<>|]', '_'
            $domainPath    = Join-Path $global:DomainsDir $domainSafe
            $filePath      = Join-Path $domainPath "$collectorSafe.json"

            $cachedFile     = Get-CachedDomainFile -FilePath $filePath
            $existingSource = $cachedFile.ById[[string]$src.id]

            $twoMonthsAgoMs = [DateTimeOffset]::UtcNow.AddDays(-60).ToUnixTimeMilliseconds()
            $srcLastEvent = [long]$src.last_event_time
            $hasBuckets = $false
            if ($existingSource) {
                $bkts = $existingSource.buckets
                if ($bkts) {
                    foreach ($p in $bkts.PSObject.Properties) {
                        $bv = 0
                        try { $bv = [int]$p.Value } catch { $bv = 0 }
                        if ($bv -gt 0) { $hasBuckets = $true; break }
                    }
                }
            }
            if (-not $hasBuckets) {
                if ($srcLastEvent -le 0 -or $srcLastEvent -lt $twoMonthsAgoMs) { continue }
            }

            $behaviorThreshold = ($allGroupNames | Where-Object { $_ -match $global:BehaviorPattern } | Select-Object -First 1)
            if (-not $behaviorThreshold) { $behaviorThreshold = "undefined" }

            $key = "$domainGroup|||$collectorName"
            if (-not $grouped.ContainsKey($key)) {
                $grouped[$key] = @{
                    domain_group   = $domainGroup
                    collector_name = $collectorName
                    sources        = [System.Collections.Generic.List[object]]::new()
                }
            }

            $newLastEventMs  = [long]$src.last_event_time
            $currentBucket   = Get-CurrentBucket -lastEventMs $newLastEventMs

            $buckets      = Get-EmptyBuckets
            $analyzedFrom = $null
            $analyzedTo   = $null
            $prevLastEventMs = 0
            $days = @("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")
            $dailyBuckets = [ordered]@{}
            foreach ($day in $days) {
                $dailyBuckets[$day] = Get-EmptyBuckets
            }

            if ($existingSource) {
                if ($existingSource.buckets) {
                    $buckets = ConvertTo-NewBuckets -ExistingBuckets $existingSource.buckets
                }
                if ($existingSource.daily_buckets) {
                    foreach ($day in $days) {
                        if ($existingSource.daily_buckets.PSObject.Properties[$day]) {
                            $dailyBuckets[$day] = ConvertTo-NewBuckets -ExistingBuckets $existingSource.daily_buckets.$day
                        }
                    }
                }
                if ($existingSource.analyzed_from) { $analyzedFrom = $existingSource.analyzed_from }
                if ($existingSource.analyzed_to)   { $analyzedTo   = $existingSource.analyzed_to }

                if ($existingSource.last_event_ms -and [long]$existingSource.last_event_ms -gt 0) {
                    $prevLastEventMs = [long]$existingSource.last_event_ms
                } elseif ($existingSource.last_event_time -and $existingSource.last_event_time -ne "Never") {
                    try {
                        $tz    = [System.TimeZoneInfo]::FindSystemTimeZoneById($global:Timezone)
                        $dtStr = $existingSource.last_event_time
                        $dt    = [datetime]::ParseExact($dtStr, "yyyy-MM-dd hh:mm:ss tt", [System.Globalization.CultureInfo]::InvariantCulture)
                        $dtUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($dt, $tz)
                        $prevLastEventMs = [DateTimeOffset]::new($dtUtc).ToUnixTimeMilliseconds()
                    } catch {}
                }
            }

            if ($newLastEventMs -gt 0 -and $prevLastEventMs -gt 0 -and $newLastEventMs -gt $prevLastEventMs) {
                $gapMs     = $newLastEventMs - $prevLastEventMs
                $gapBucket = Get-GapBucket -gapMs $gapMs
                if ($gapBucket) {
                    $gapDayUtc   = [DateTimeOffset]::FromUnixTimeMilliseconds($prevLastEventMs).UtcDateTime
                    $gapDayLocal = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($gapDayUtc, $global:Timezone)

                    $overrideMs = $null
                    if ($overridesData -and $overridesData.PSObject.Properties[[string]$src.id]) {
                        $overrideMs = [long]$overridesData.([string]$src.id)
                    }

                    $pendingGaps.Add([ordered]@{
                        src_id      = [string]$src.id
                        src_name    = [string]$src.name
                        collector   = $collectorName
                        prev_ms     = $prevLastEventMs
                        new_ms      = $newLastEventMs
                        gap_ms      = $gapMs
                        bucket      = $gapBucket
                        day         = $gapDayLocal.DayOfWeek.ToString()
                        buckets_ref = $buckets
                        daily_ref   = $dailyBuckets
                        prev_src    = $existingSource
                        override_ms = $overrideMs
                        was_alarm   = (Test-GapWasAbnormal -ExistingSource $existingSource -PrevMs $prevLastEventMs -NewMs $newLastEventMs -OverrideMs $overrideMs)
                    })
                }
            }

            $protocolType = ""
            $identifier   = ""
            $customLabel  = $null
            $statusState  = "NA"
            $statusReason = ""

            $sidInt = [int]$src.id
            if ($global:ProtocolCache -and $global:ProtocolCache.ContainsKey($sidInt)) {
                $cachedProto = $global:ProtocolCache[$sidInt]
                if ($cachedProto.ContainsKey("status_state"))  { $statusState  = [string]$cachedProto["status_state"] }
                if ($cachedProto.ContainsKey("status_reason")) { $statusReason = [string]$cachedProto["status_reason"] }
            }

            $protocolCached = $false

            if ($global:ProtocolCache -and $global:ProtocolCache.ContainsKey($sidInt)) {
                $pc = $global:ProtocolCache[$sidInt]
                if ($pc.ContainsKey("protocol_type") -and $pc["protocol_type"]) {
                    $protocolType   = [string]$pc["protocol_type"]
                    $identifier     = if ($pc.ContainsKey("identifier")) { [string]$pc["identifier"] } else { "" }
                    $protocolCached = $true
                }
            }

            if ($existingSource) {
                if ($existingSource.custom_label) { $customLabel = $existingSource.custom_label }
                if (-not $protocolCached -and $existingSource.PSObject.Properties["protocol_type"] -and $existingSource.protocol_type) {
                    $protocolType   = [string]$existingSource.protocol_type
                    $identifier     = if ($existingSource.PSObject.Properties["identifier"]) { [string]$existingSource.identifier } else { "" }
                    $protocolCached = $true
                }
            }

            if (-not $protocolCached) {
                try {
                    $details      = Get-LogSourceDetails -LogSourceId $src.id
                    $protocolType = $details.protocol_type
                    $identifier   = $details.identifier
                } catch {
                    Write-Log "Get-LogSourceDetails failed for source $($src.id) ($($src.name)): $($_.Exception.Message). Keeping last known protocol; last_event_time will still be updated." -Level WARN
                    $protocolType = if ($existingSource -and $existingSource.PSObject.Properties["protocol_type"]) { [string]$existingSource.protocol_type } else { "" }
                    $identifier   = if ($existingSource -and $existingSource.PSObject.Properties["identifier"])    { [string]$existingSource.identifier }    else { "" }
                }
            }

            $entry = [ordered]@{
                id                 = $src.id
                name               = $src.name
                log_source_type    = $Types[[int]$src.type_id]
                domain_group       = $domainGroup
                behavior_threshold = $behaviorThreshold
                custom_label       = $customLabel
                creation_date      = Convert-ToJordan -ms $src.creation_date
                last_event_time    = Convert-ToJordan -ms $newLastEventMs
                last_event_ms      = $newLastEventMs
                average_eps        = $src.average_eps
                current_bucket     = $currentBucket
                analyzed_from      = $analyzedFrom
                analyzed_to        = $analyzedTo
                buckets            = $buckets
                daily_buckets      = $dailyBuckets
                protocol_type      = $protocolType
                identifier         = $identifier
                status_state       = $statusState
                status_reason      = $statusReason
            }

            $grouped[$key].sources.Add($entry)
        } catch {
            Write-Log "Write-DomainJson: source $($src.id) ($($src.name)) failed this cycle: $($_.Exception.Message)" -Level WARN
            continue
        }
    }

    Get-ChildItem -Path $global:DomainsDir -Filter "*.tmp" -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    $tmpStopsPath = (Join-Path $global:DataDir "stops.json") + ".tmp"
    if (Test-Path $tmpStopsPath) { Remove-Item $tmpStopsPath -Force -ErrorAction SilentlyContinue }

    if ($grouped.Keys.Count -eq 0) {
        Write-Log "Write-DomainJson: grouped result is empty, skipping write" -Level WARN
        return
    }

    $totalFromPoll = ($grouped.Values | ForEach-Object { $_.sources.Count } | Measure-Object -Sum).Sum

    $stateFile = Join-Path $global:DataDir "state.json"
    $prevTotalOnDisk = 0
    if (Test-Path $stateFile) {
        try {
            $prevState = Get-Content $stateFile -Raw | ConvertFrom-Json
            if ($prevState.total_sources) { $prevTotalOnDisk = [int]$prevState.total_sources }
        } catch {}
    }

    if ($prevTotalOnDisk -gt 100 -and $totalFromPoll -lt ($prevTotalOnDisk * 0.5)) {
        Write-Log "Write-DomainJson: poll returned only $totalFromPoll sources but state.json reports $prevTotalOnDisk - possible partial poll, skipping write to protect data" -Level WARN
        return
    }

    $suppressedIds  = Get-SuppressedGapSourceIds -Gaps $pendingGaps
    $appliedGaps    = 0
    $skippedGaps    = 0
    $skipReasons    = @{}
    $skipCollectors = @{}

    foreach ($g in $pendingGaps) {
        $sid       = [string]$g.src_id
        $gapBucket = [string]$g.bucket

        if ($suppressedIds.ContainsKey($sid)) {
            $skippedGaps++
            $reason = [string]$suppressedIds[$sid]
            if ($skipReasons.ContainsKey($reason)) { $skipReasons[$reason]++ } else { $skipReasons[$reason] = 1 }
            $skipCollectors[[string]$g.collector] = $true
            continue
        }

        $bucketsRef = $g.buckets_ref
        $bucketsRef[$gapBucket] = [int]$bucketsRef[$gapBucket] + 1

        $dayRef = $g.daily_ref[[string]$g.day]
        if ($dayRef) { $dayRef[$gapBucket] = [int]$dayRef[$gapBucket] + 1 }
        $appliedGaps++

        if (-not $g.was_alarm) { continue }

        $prevLastEventMs = [long]$g.prev_ms
        $newLastEventMs  = [long]$g.new_ms
        $gapMs           = [long]$g.gap_ms
        $dayName         = [string]$g.day

        if (-not $allStops.ContainsKey($sid)) {
            $allStops[$sid] = [System.Collections.Generic.List[object]]::new()
        }

        $bktOrderStops = Get-BucketOrder
        $gapBucketIdx  = $bktOrderStops.IndexOf($gapBucket)
        $minBucketIdx  = $bktOrderStops.IndexOf("20m")
        $perBucketCap  = [int]$global:MaxBucketMinCount

        $bucketTally = @{}
        foreach ($existingStop in $allStops[$sid]) {
            $eb = $null
            if ($existingStop -is [System.Collections.IDictionary]) { $eb = $existingStop["bucket"] }
            elseif ($existingStop.PSObject.Properties["bucket"])      { $eb = $existingStop.bucket }
            if ($eb) {
                $ebs = [string]$eb
                if ($bucketTally.ContainsKey($ebs)) { $bucketTally[$ebs]++ } else { $bucketTally[$ebs] = 1 }
            }
        }

        $definedMaxIdx = -1
        foreach ($bk in $bucketTally.Keys) {
            if ($bucketTally[$bk] -ge $perBucketCap) {
                $bi = $bktOrderStops.IndexOf($bk)
                if ($bi -gt $definedMaxIdx) { $definedMaxIdx = $bi }
            }
        }

        $sameBucketCount = if ($bucketTally.ContainsKey($gapBucket)) { $bucketTally[$gapBucket] } else { 0 }

        if ($gapBucketIdx -ge $minBucketIdx -and $sameBucketCount -lt $perBucketCap -and $gapBucketIdx -ge $definedMaxIdx) {
            $stopEntry = [ordered]@{
                start_ms   = $prevLastEventMs
                end_ms     = $newLastEventMs
                gap_ms     = $gapMs
                bucket     = $gapBucket
                day        = $dayName
                started_at = (Convert-ToJordan -ms $prevLastEventMs)
                ended_at   = (Convert-ToJordan -ms $newLastEventMs)
            }
            $allStops[$sid].Add($stopEntry)
            $stopsDirty = $true
        }
    }

    if ($skippedGaps -gt 0) {
        $detail = (($skipReasons.Keys | ForEach-Object { "$($skipReasons[$_]) x $_" }) -join ", ")
        Write-Log ("Downtime guard: skipped {0} of {1} gaps this cycle across {2} collector(s) [{3}]. Buckets and stops were NOT updated for those sources." -f $skippedGaps, $pendingGaps.Count, $skipCollectors.Keys.Count, $detail) -Level WARN
    }
    if ($appliedGaps -gt 0) {
        Write-Log "Recorded $appliedGaps gap(s) into bucket history this cycle"
    }

    $writtenIds = @{}

    $claimedIds = @{}
    foreach ($key in @($grouped.Keys)) {
        foreach ($s in $grouped[$key].sources) { $claimedIds[[string]$s.id] = $true }
    }
    $movedAway = 0

    foreach ($key in @($grouped.Keys)) {
        $grp           = $grouped[$key]
        $domainSafe    = $grp.domain_group   -replace '[\\/:*?"<>|]', '_'
        $collectorSafe = $grp.collector_name -replace '[\\/:*?"<>|]', '_'
        $domainPath    = Join-Path $global:DomainsDir $domainSafe

        if (-not (Test-Path $domainPath)) { New-Item -ItemType Directory -Path $domainPath | Out-Null }

        $filePath = Join-Path $domainPath "$collectorSafe.json"

        $existingIds = @{}
        $grp.sources | ForEach-Object { $existingIds[[string]$_.id] = $true }

        $cachedFile = Get-CachedDomainFile -FilePath $filePath
        foreach ($ds in $cachedFile.Array) {
            $dsIdStr = [string]$ds.id
            if ($existingIds.ContainsKey($dsIdStr)) { continue }
            if ($claimedIds.ContainsKey($dsIdStr)) { $movedAway++; continue }

            $dsId = 0
            try { $dsId = [int]$ds.id } catch {}
            $dsType = [string]$ds.log_source_type
            $dsName = [string]$ds.name

            $ignoredByType      = $global:IgnoreTypes      -and ($global:IgnoreTypes | Where-Object { $dsType -like "*$_*" })
            $ignoredById        = $global:IgnoreSourceIds  -contains $dsId
            $ignoredByCollector = $global:IgnoreCollectors -contains $grp.collector_name
            $ignoredByName      = $global:IgnoreNamePatterns -and ($global:IgnoreNamePatterns | Where-Object { $dsName -like "*$_*" })
            $ignoredByGroup     = $ignoredGroupIds.Contains($dsIdStr)

            if (-not ($ignoredByType -or $ignoredById -or $ignoredByCollector -or $ignoredByName -or $ignoredByGroup)) {
                $grp.sources.Add($ds)
            }
        }

        $sortedSources = $grp.sources | Sort-Object { $_.name }

        $output = [ordered]@{
            collector_name = $grp.collector_name
            domain_group   = $grp.domain_group
            last_updated   = $now
            log_sources    = @($sortedSources)
        }

        $domainJson = $output | ConvertTo-Json -Depth 10
        [void](Save-JsonAtomic -Json $domainJson -Path $filePath)

        $writtenIds[[System.IO.Path]::GetFullPath($filePath)] = @($sortedSources | ForEach-Object { [string]$_.id })
    }

    if ($stopsDirty) {
        $stopsJson = $allStops | ConvertTo-Json -Depth 6
        [void](Save-JsonAtomic -Json $stopsJson -Path $stopsFile)
    }

    $uniqueIds     = [System.Collections.Generic.HashSet[string]]::new()
    $duplicateHits = 0

    Get-ChildItem -Path $global:DomainsDir -Filter "*.json" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $fp  = [System.IO.Path]::GetFullPath($_.FullName)
        $ids = $null
        if ($writtenIds.ContainsKey($fp)) {
            $ids = $writtenIds[$fp]
        } else {
            try {
                $fc  = Get-Content $fp -Raw | ConvertFrom-Json
                $ids = @(@($fc.log_sources) | ForEach-Object { [string]$_.id })
            } catch { $ids = @() }
        }
        foreach ($idStr in @($ids)) {
            if ([string]::IsNullOrWhiteSpace($idStr)) { continue }
            if (-not $uniqueIds.Add($idStr)) { $duplicateHits++ }
        }
    }

    $totalWritten = $uniqueIds.Count

    if ($movedAway -gt 0) {
        Write-Log "Write-DomainJson: dropped $movedAway stale copy/copies of sources that moved to another domain or collector"
    }
    if ($duplicateHits -gt 0) {
        Write-Log "Write-DomainJson: $duplicateHits duplicate source id(s) still present across collector files, counted once. A stale copy clears the next time that collector is written." -Level WARN
    }

    $stateJson = @{ total_sources = $totalWritten; duplicate_entries = $duplicateHits; last_updated = $now } | ConvertTo-Json
    [void](Save-JsonAtomic -Json $stateJson -Path $stateFile)
}