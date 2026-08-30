function Convert-EpsToJordan {
    param([long]$ms)
    if ($ms -le 0) { return "" }
    [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [DateTimeOffset]::FromUnixTimeMilliseconds($ms).UtcDateTime,
        $global:Timezone
    ).ToString("yyyy-MM-dd hh:mm:ss tt")
}

function Get-EpsWindowSeconds {
    param([string]$Period, [long]$StartMs, [long]$EndMs)
    if ($StartMs -gt 0 -and $EndMs -gt $StartMs) {
        return [math]::Max(1, [math]::Floor(($EndMs - $StartMs) / 1000))
    }
    switch -Regex ($Period) {
        'LAST\s+(\d+)\s+MINUTES' { return [int]$Matches[1] * 60 }
        'LAST\s+(\d+)\s+HOURS'   { return [int]$Matches[1] * 3600 }
        'LAST\s+(\d+)\s+DAYS'    { return [int]$Matches[1] * 86400 }
        default                  { return 3600 }
    }
}

function Invoke-EpsArielQuery {
    param([int[]]$SourceIds, [string]$Period, [long]$StartMs, [long]$EndMs, [double]$WindowSeconds)

    $idList = ($SourceIds | ForEach-Object { [string]$_ }) -join ','

    if ($StartMs -gt 0 -and $EndMs -gt $StartMs) {
        $startStr = ([DateTimeOffset]::FromUnixTimeMilliseconds($StartMs).UtcDateTime).ToString("yyyy-MM-dd HH:mm")
        $endStr   = ([DateTimeOffset]::FromUnixTimeMilliseconds($EndMs).UtcDateTime).ToString("yyyy-MM-dd HH:mm")
        $timeClause = "START '$startStr' STOP '$endStr'"
    } else {
        $timeClause = $Period
    }

    $aql = @"
SELECT logsourcename(logsourceid) AS src, logsourceid, COUNT(*) AS events, COUNT(*) / $WindowSeconds AS eps
FROM events
WHERE logsourceid IN ($idList)
GROUP BY logsourceid
ORDER BY events DESC
$timeClause
"@

    $base    = "https://$($global:QRadarHost)/api/ariel/searches"
    $encoded = [System.Uri]::EscapeDataString($aql)

    $postReq = [System.Net.HttpWebRequest]::Create("$base`?query_expression=$encoded")
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

    $status = "WAIT"
    $tries  = 0
    while ($status -in @("WAIT","EXECUTE","SORTING") -and $tries -lt 600) {
        Start-Sleep -Seconds 2
        $tries++
        $statReq = [System.Net.HttpWebRequest]::Create("$base/$searchId")
        $statReq.Method = "GET"
        $statReq.Headers.Add("SEC", $global:AuthHeader["SEC"])
        $statReq.Headers.Add("Version", "14.0")
        $statReq.Accept = "application/json"
        $statResp   = $statReq.GetResponse()
        $statReader = New-Object System.IO.StreamReader($statResp.GetResponseStream())
        $statJson   = $statReader.ReadToEnd()
        $statReader.Close(); $statResp.Close()
        $statObj = $statJson | ConvertFrom-Json
        $status  = $statObj.status
    }

    if ($status -ne "COMPLETED") { throw "Search ended with status: $status" }

    $resReq = [System.Net.HttpWebRequest]::Create("$base/$searchId/results")
    $resReq.Method = "GET"
    $resReq.Headers.Add("SEC", $global:AuthHeader["SEC"])
    $resReq.Headers.Add("Version", "14.0")
    $resReq.Accept = "application/json"
    $resReq.AddRange("items", 0, 5000000)
    $resResp   = $resReq.GetResponse()
    $resReader = New-Object System.IO.StreamReader($resResp.GetResponseStream())
    $resJson   = $resReader.ReadToEnd()
    $resReader.Close(); $resResp.Close()
    $result = $resJson | ConvertFrom-Json

    return $result.events
}

function Invoke-EpsTest {
    param(
        [int[]]$SourceIds,
        [string]$Period = "LAST 1 HOURS",
        [long]$StartMs = 0,
        [long]$EndMs = 0
    )

    if (-not $SourceIds -or $SourceIds.Count -eq 0) {
        throw "No source IDs provided for this collector"
    }

    $windowSec = Get-EpsWindowSeconds -Period $Period -StartMs $StartMs -EndMs $EndMs
    $raw = Invoke-EpsArielQuery -SourceIds $SourceIds -Period $Period -StartMs $StartMs -EndMs $EndMs -WindowSeconds $windowSec

    $rows = @()
    foreach ($r in $raw) {
        $events = 0.0
        $eps    = 0.0
        [double]::TryParse([string]$r.events, [ref]$events) | Out-Null
        [double]::TryParse([string]$r.eps, [ref]$eps) | Out-Null
        $rows += [ordered]@{
            src          = [string]$r.src
            logsourceid  = [string]$r.logsourceid
            events       = [long]$events
            eps          = [math]::Round($eps, 2)
        }
    }

    $rows = @($rows | Sort-Object -Property @{ Expression = { [long]$_.events } } -Descending)

    $totalEvents = 0
    $totalEps    = 0.0
    foreach ($row in $rows) { $totalEvents += [long]$row.events; $totalEps += [double]$row.eps }

    $highest = $null
    $lowest  = $null
    foreach ($row in $rows) {
        if ($null -eq $highest -or [long]$row.events -gt [long]$highest.events) { $highest = $row }
        if ($null -eq $lowest  -or [long]$row.events -lt [long]$lowest.events)  { $lowest  = $row }
    }

    $windowLabel = if ($StartMs -gt 0 -and $EndMs -gt $StartMs) {
        "$(Convert-EpsToJordan -ms $StartMs) -> $(Convert-EpsToJordan -ms $EndMs)"
    } else {
        $Period
    }

    return [ordered]@{
        rows         = $rows
        highest      = $highest
        lowest       = $lowest
        total_events = $totalEvents
        total_eps    = [math]::Round($totalEps, 2)
        avg_eps      = if ($rows.Count -gt 0) { [math]::Round($totalEps / $rows.Count, 2) } else { 0 }
        avg_events   = if ($rows.Count -gt 0) { [long][math]::Round($totalEvents / $rows.Count, 0) } else { 0 }
        source_count = $rows.Count
        window_label = $windowLabel
        window_sec   = $windowSec
    }
}