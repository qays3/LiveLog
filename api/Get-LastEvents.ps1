function Invoke-LastEventsSearchOnce {
    param([long]$StartMs, [long]$EndMs)

    if ($StartMs -le 0 -or $EndMs -le $StartMs) {
        throw "Invoke-LastEventsSearchOnce requires a valid StartMs/EndMs window"
    }

    $startStr = ([DateTimeOffset]::FromUnixTimeMilliseconds($StartMs).UtcDateTime).ToString("yyyy-MM-dd HH:mm:ss")
    $endStr   = ([DateTimeOffset]::FromUnixTimeMilliseconds($EndMs).UtcDateTime).ToString("yyyy-MM-dd HH:mm:ss")
    $timeClause = "START '$startStr' STOP '$endStr'"

    $aql = "SELECT logsourceid, MAX(starttime) AS last_ms FROM events WHERE qid != 38750074 GROUP BY logsourceid $timeClause"

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

    $status  = "WAIT"
    $statObj = $null
    $waited  = 0

    while ($status -in @("WAIT", "EXECUTE", "SORTING")) {
        Start-Sleep -Milliseconds 500
        $waited += 0.5

        if ($waited -gt $global:LastEventQueryTimeoutSec) {
            Remove-LastEventsSearch -SearchId $searchId -Base $base
            throw "Search exceeded timeout of $($global:LastEventQueryTimeoutSec)s (status: $status)"
        }

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

        $statObj = $statJson | ConvertFrom-Json
        $status  = $statObj.status
    }

    if ($status -ne "COMPLETED") {
        $detail = ""
        try {
            if ($statObj.error_messages) {
                $detail = ($statObj.error_messages | ForEach-Object { $_.message }) -join "; "
            }
        } catch {}
        Remove-LastEventsSearch -SearchId $searchId -Base $base
        if ($detail) { throw "Search ended with status: $status -- $detail" }
        throw "Search ended with status: $status"
    }

    $resReq = [System.Net.HttpWebRequest]::Create("$base/$searchId/results")
    $resReq.Timeout = 600000; $resReq.ReadWriteTimeout = 600000
    $resReq.Method = "GET"
    $resReq.Headers.Add("SEC", $global:AuthHeader["SEC"])
    $resReq.Headers.Add("Version", "14.0")
    $resReq.Accept = "application/json"

    $resResp   = $resReq.GetResponse()
    $resReader = New-Object System.IO.StreamReader($resResp.GetResponseStream())
    $resJson   = $resReader.ReadToEnd()
    $resReader.Close(); $resResp.Close()

    Remove-LastEventsSearch -SearchId $searchId -Base $base

    $rows = ($resJson | ConvertFrom-Json).events
    $map  = @{}

    foreach ($r in @($rows)) {
        if ($null -eq $r.logsourceid) { continue }

        $sid = 0
        $ms  = [long]0
        try { $sid = [int]$r.logsourceid } catch { continue }
        try { $ms  = [long][double]$r.last_ms } catch { $ms = 0 }

        if ($sid -le 0 -or $ms -le 0) { continue }

        if (-not $map.ContainsKey($sid) -or $ms -gt $map[$sid]) {
            $map[$sid] = $ms
        }
    }

    return $map
}

function Remove-LastEventsSearch {
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

function Get-LastEvents {
    param([long]$StartMs, [long]$EndMs)

    $attempts = 2
    $lastErr  = $null

    for ($a = 1; $a -le $attempts; $a++) {
        try {
            return Invoke-LastEventsSearchOnce -StartMs $StartMs -EndMs $EndMs
        } catch {
            $lastErr = $_.Exception.Message
            Write-Log "Get-LastEvents attempt $a/$attempts failed: $lastErr" -Level WARN
            if ($a -lt $attempts) { Start-Sleep -Seconds 2 }
        }
    }

    throw "Get-LastEvents failed after $attempts attempts: $lastErr"
}

function Merge-LastEvents {
    param(
        [object[]]$LogSources,
        [hashtable]$LastEventMap
    )

    if (-not $LastEventMap) { return $LogSources }

    $hits = 0
    $kept = 0

    foreach ($src in $LogSources) {
        $sid = [int]$src.id

        if ($LastEventMap.ContainsKey($sid)) {
            $arielMs = [long]$LastEventMap[$sid]
            $lsmMs   = [long]0
            try { $lsmMs = [long]$src.last_event_time } catch { $lsmMs = 0 }

            if ($arielMs -ge $lsmMs) {
                $src.last_event_time = $arielMs
            } else {
                $src.last_event_time = $lsmMs
            }
            $hits++
        } else {
            $kept++
        }
    }

    Write-Log "Get-LastEvents: matched $hits of $($LogSources.Count) log sources from Ariel ($kept kept from LSM)"
    return $LogSources
}