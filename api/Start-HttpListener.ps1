function Send-JsonResponse {
    param($context, [int]$statusCode, $body)

    if ($null -eq $body) {
        $json = "{}"
    }
    elseif ($body -is [System.Collections.IEnumerable] -and $body -isnot [string] -and $body -isnot [System.Collections.IDictionary]) {
        $arr  = @($body)
        $json = if ($arr.Count -eq 0) { "[]" } else { ConvertTo-Json -InputObject $arr -Depth 10 }
    }
    else {
        $json = ConvertTo-Json -InputObject $body -Depth 10
    }

    if ([string]::IsNullOrEmpty($json)) { $json = "{}" }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    try {
        $context.Response.StatusCode = $statusCode
        $context.Response.ContentType = "application/json"
        $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.OutputStream.Close()
    } catch [System.Net.HttpListenerException] {
    } catch [System.InvalidOperationException] {
    } catch [System.IO.IOException] {
    }
}

function Send-FileResponse {
    param($context, [string]$filePath)
    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
    $mimeMap = @{
        ".html" = "text/html; charset=utf-8"
        ".css"  = "text/css"
        ".js"   = "application/javascript"
        ".json" = "application/json"
        ".png"  = "image/png"
        ".ico"  = "image/x-icon"
        ".svg"  = "image/svg+xml"
    }
    $mime  = if ($mimeMap[$ext]) { $mimeMap[$ext] } else { "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $context.Response.StatusCode = 200
    $context.Response.ContentType = $mime
    $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
    if ($mime -eq "application/json") {
        $context.Response.AddHeader("Cache-Control", "no-store")
    } else {
        $context.Response.AddHeader("Cache-Control", "public, max-age=3600")
    }
    try {
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.OutputStream.Close()
    } catch [System.Net.HttpListenerException] {
    } catch [System.InvalidOperationException] {
    } catch [System.IO.IOException] {
    }
}

function Start-HttpListener {
    param([string]$WebRoot)

    $labelsFile    = Join-Path $global:DataDir "labels.json"
    $overridesFile = Join-Path $global:DataDir "overrides.json"

    . (Join-Path $WebRoot "api\Invoke-AnalysisJobs.ps1")
    Initialize-AnalysisJobStore

    . (Join-Path $WebRoot "api\Invoke-EpsJobs.ps1")
    Initialize-EpsJobStore

    . (Join-Path $WebRoot "api\Invoke-CanvasStore.ps1")
    $global:WebRoot = $WebRoot

    . (Join-Path $WebRoot "api\Invoke-DashboardStore.ps1")

    . (Join-Path $WebRoot "api\Invoke-ToolStore.ps1")

    $listener = New-Object System.Net.HttpListener
    $bindHost = if ($global:BindHost -and $global:BindHost -ne "0.0.0.0" -and $global:BindHost -ne "localhost") { $global:BindHost } else { "localhost" }
    $listener.Prefixes.Add("http://$bindHost`:$($global:HttpPort)/")
    $listener.Start()

    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $req     = $context.Request
            $method  = $req.HttpMethod
            $rawPath = $req.Url.AbsolutePath
            if ($rawPath -eq "") { $rawPath = "/" }

            if ($method -eq "OPTIONS") {
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.AddHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
                $context.Response.AddHeader("Access-Control-Allow-Headers", "Content-Type")
                $context.Response.StatusCode = 204
                $context.Response.Close()
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/config") {
                $configJson = "{`"app_name`":`"$($global:AppName)`",`"alert_buffer_minutes`":$($global:AlertBufferMin),`"max_bucket_min_count`":$($global:MaxBucketMinCount),`"min_alert_minutes`":$($global:MinAlertMinutes)}"
                $cfgBytes = [System.Text.Encoding]::UTF8.GetBytes($configJson)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $cfgBytes.Length
                $context.Response.OutputStream.Write($cfgBytes, 0, $cfgBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/labels") {
                $labels = @{}
                if (Test-Path $labelsFile) {
                    try { $labels = Get-Content $labelsFile -Raw | ConvertFrom-Json } catch {}
                }
                Send-JsonResponse -context $context -statusCode 200 -body $labels
                continue
            }

            if ($method -eq "PUT" -and $rawPath -match '^/api/labels/(\d+)$') {
                $id = $Matches[1]
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                $payload = $bodyText | ConvertFrom-Json
                $labels  = @{}
                if (Test-Path $labelsFile) {
                    try {
                        $raw = Get-Content $labelsFile -Raw
                        $obj = $raw | ConvertFrom-Json
                        $obj.PSObject.Properties | ForEach-Object { $labels[$_.Name] = $_.Value }
                    } catch {}
                }
                $labels[$id] = $payload.label
                $labels | ConvertTo-Json | Set-Content -Path $labelsFile -Encoding UTF8
                $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $okBytes.Length
                $context.Response.OutputStream.Write($okBytes, 0, $okBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "GET" -and $rawPath -match '^/api/stops/(\d+)$') {
                $srcId     = $Matches[1]
                $stopsFile = Join-Path $global:DataDir "stops.json"
                $entries   = [System.Collections.Generic.List[object]]::new()
                if (Test-Path $stopsFile) {
                    try {
                        $raw = Get-Content $stopsFile -Raw | ConvertFrom-Json
                        if ($raw.PSObject.Properties[$srcId]) {
                            $raw.$srcId | ForEach-Object { $entries.Add($_) }
                        }
                    } catch {}
                }
                $json  = if ($entries.Count -eq 0) { "[]" } else { (@($entries) | ConvertTo-Json -Depth 6) }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "PUT" -and $rawPath -match '^/api/stops/(\d+)/(\d+)/note$') {
                $srcId      = $Matches[1]
                $stopIdx    = [int]$Matches[2]
                $stopsFile  = Join-Path $global:DataDir "stops.json"
                $reader     = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText   = $reader.ReadToEnd()
                $reader.Close()
                $payload    = $bodyText | ConvertFrom-Json
                $note       = if ($payload.note) { [string]$payload.note } else { "" }
                $allStops   = @{}
                if (Test-Path $stopsFile) {
                    try {
                        $raw = Get-Content $stopsFile -Raw | ConvertFrom-Json
                        $raw.PSObject.Properties | ForEach-Object { $allStops[$_.Name] = [System.Collections.Generic.List[object]]($_.Value) }
                    } catch {}
                }
                $ok = $false
                if ($allStops.ContainsKey($srcId) -and $stopIdx -lt $allStops[$srcId].Count) {
                    $entry = $allStops[$srcId][$stopIdx]
                    $entryHash = [ordered]@{}
                    $entry.PSObject.Properties | ForEach-Object { $entryHash[$_.Name] = $_.Value }
                    $entryHash["note"] = $note
                    $allStops[$srcId][$stopIdx] = $entryHash
                    $tempStops = $stopsFile + ".tmp"
                    $allStops | ConvertTo-Json -Depth 6 | Set-Content -Path $tempStops -Encoding UTF8
                    Move-Item -Path $tempStops -Destination $stopsFile -Force
                    $ok = $true
                }
                $respJson = if ($ok) { '{"success":true}' } else { '{"success":false}' }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($respJson)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.AddHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "POST" -and $rawPath -eq "/api/stops/bulk-delete") {
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()

                $removed = 0
                $ok      = $false
                try {
                    $payload = $bodyText | ConvertFrom-Json
                    $targets = @($payload.targets)

                    $stopsFile = Join-Path $global:DataDir "stops.json"
                    $allStops  = @{}
                    if (Test-Path $stopsFile) {
                        try {
                            $raw = Get-Content $stopsFile -Raw | ConvertFrom-Json
                            $raw.PSObject.Properties | ForEach-Object { $allStops[$_.Name] = [System.Collections.Generic.List[object]]($_.Value) }
                        } catch {}
                    }

                    $bySource = @{}
                    foreach ($t in $targets) {
                        $sid = [string]$t.source_id
                        $idx = [int]$t.index
                        if (-not $bySource.ContainsKey($sid)) {
                            $bySource[$sid] = [System.Collections.Generic.List[int]]::new()
                        }
                        $bySource[$sid].Add($idx)
                    }

                    foreach ($sid in $bySource.Keys) {
                        if (-not $allStops.ContainsKey($sid)) { continue }
                        $idxList = @($bySource[$sid] | Sort-Object -Descending -Unique)
                        foreach ($i in $idxList) {
                            if ($i -ge 0 -and $i -lt $allStops[$sid].Count) {
                                $allStops[$sid].RemoveAt($i)
                                $removed++
                            }
                        }
                        if ($allStops[$sid].Count -eq 0) { $allStops.Remove($sid) }
                    }

                    $tempStops = $stopsFile + ".tmp"
                    $outJson   = ConvertTo-Json -InputObject $allStops -Depth 6
                    if ([string]::IsNullOrEmpty($outJson)) { $outJson = "{}" }
                    Set-Content -Path $tempStops -Value $outJson -Encoding UTF8
                    Move-Item -Path $tempStops -Destination $stopsFile -Force
                    $ok = $true
                } catch {
                    $ok = $false
                }

                $respJson = if ($ok) { "{`"success`":true,`"removed`":$removed}" } else { '{"success":false,"removed":0}' }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($respJson)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.AddHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -match '^/api/stops/(\d+)/(\d+)$') {
                $srcId     = $Matches[1]
                $stopIdx   = [int]$Matches[2]
                $stopsFile = Join-Path $global:DataDir "stops.json"
                $allStops  = @{}
                if (Test-Path $stopsFile) {
                    try {
                        $raw = Get-Content $stopsFile -Raw | ConvertFrom-Json
                        $raw.PSObject.Properties | ForEach-Object { $allStops[$_.Name] = [System.Collections.Generic.List[object]]($_.Value) }
                    } catch {}
                }
                $ok = $false
                if ($allStops.ContainsKey($srcId) -and $stopIdx -lt $allStops[$srcId].Count) {
                    $allStops[$srcId].RemoveAt($stopIdx)
                    $tempStops = $stopsFile + ".tmp"
                    $allStops | ConvertTo-Json -Depth 6 | Set-Content -Path $tempStops -Encoding UTF8
                    Move-Item -Path $tempStops -Destination $stopsFile -Force
                    $ok = $true
                }
                $respJson = if ($ok) { '{"success":true}' } else { '{"success":false}' }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($respJson)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.AddHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/alert-status") {
                $asFile = Join-Path $global:DataDir "alert-status.json"
                $json = "{}"
                if (Test-Path $asFile) { try { $json = Get-Content $asFile -Raw } catch {} }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "PUT" -and $rawPath -match '^/api/alert-status/(\d+)$') {
                $srcId  = $Matches[1]
                $asFile = Join-Path $global:DataDir "alert-status.json"
                $reader = New-Object System.IO.StreamReader($req.InputStream)
                $body   = $reader.ReadToEnd(); $reader.Close()
                $payload = $body | ConvertFrom-Json
                $data = @{}
                if (Test-Path $asFile) { try { $raw = Get-Content $asFile -Raw | ConvertFrom-Json; $raw.PSObject.Properties | ForEach-Object { $data[$_.Name] = $_.Value } } catch {} }
                $data[$srcId] = $payload
                $data | ConvertTo-Json -Depth 4 | Set-Content -Path $asFile -Encoding UTF8
                $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $okBytes.Length
                $context.Response.OutputStream.Write($okBytes, 0, $okBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -match '^/api/alert-status/(\d+)$') {
                $srcId  = $Matches[1]
                $asFile = Join-Path $global:DataDir "alert-status.json"
                $data = @{}
                if (Test-Path $asFile) { try { $raw = Get-Content $asFile -Raw | ConvertFrom-Json; $raw.PSObject.Properties | ForEach-Object { $data[$_.Name] = $_.Value } } catch {} }
                $data.Remove($srcId)
                $data | ConvertTo-Json -Depth 4 | Set-Content -Path $asFile -Encoding UTF8
                $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $okBytes.Length
                $context.Response.OutputStream.Write($okBytes, 0, $okBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/overrides") {
                $overrides = @{}
                if (Test-Path $overridesFile) {
                    try {
                        $raw = Get-Content $overridesFile -Raw
                        $obj = $raw | ConvertFrom-Json
                        $obj.PSObject.Properties | ForEach-Object { $overrides[$_.Name] = $_.Value }
                    } catch {}
                }
                Send-JsonResponse -context $context -statusCode 200 -body $overrides
                continue
            }

            if ($method -eq "PUT" -and $rawPath -match '^/api/overrides/(\d+)$') {
                $id = $Matches[1]
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                $payload   = $bodyText | ConvertFrom-Json
                $overrides = @{}
                if (Test-Path $overridesFile) {
                    try {
                        $raw = Get-Content $overridesFile -Raw
                        $obj = $raw | ConvertFrom-Json
                        $obj.PSObject.Properties | ForEach-Object { $overrides[$_.Name] = $_.Value }
                    } catch {}
                }
                $overrides[$id] = $payload.manual_max_ms
                $overrides | ConvertTo-Json | Set-Content -Path $overridesFile -Encoding UTF8
                $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $okBytes.Length
                $context.Response.OutputStream.Write($okBytes, 0, $okBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -match '^/api/overrides/(\d+)$') {
                $id = $Matches[1]
                $overrides = @{}
                if (Test-Path $overridesFile) {
                    try {
                        $raw = Get-Content $overridesFile -Raw
                        $obj = $raw | ConvertFrom-Json
                        $obj.PSObject.Properties | ForEach-Object { $overrides[$_.Name] = $_.Value }
                    } catch {}
                }
                $overrides.Remove($id)
                $overrides | ConvertTo-Json | Set-Content -Path $overridesFile -Encoding UTF8
                $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.AddHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
                $context.Response.ContentLength64 = $okBytes.Length
                $context.Response.OutputStream.Write($okBytes, 0, $okBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "GET" -and $rawPath -match '^/api/logsource-detail/(\d+)') {
                $srcId = $Matches[1]
                try {
                    try { Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsDetail : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@ } catch {}
                    [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsDetail
                    [System.Net.ServicePointManager]::SecurityProtocol  = [System.Net.SecurityProtocolType]::Tls12

                    $headers = @{
                        SEC           = $global:QRadarToken
                        Accept        = "application/json"
                        Version       = "14.0"
                    }
                    $uri  = "https://$($global:QRadarHost)/api/config/event_sources/log_source_management/log_sources/$srcId"
                    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get -ErrorAction Stop
                    $json = $resp | ConvertTo-Json -Depth 5
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $context.Response.StatusCode = 200
                    $context.Response.ContentType = "application/json"
                    $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                    $context.Response.ContentLength64 = $bytes.Length
                    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $context.Response.OutputStream.Close()
                } catch {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes("{}")
                    $context.Response.StatusCode = 200
                    $context.Response.ContentType = "application/json"
                    $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                    $context.Response.ContentLength64 = $bytes.Length
                    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $context.Response.OutputStream.Close()
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/analysis-jobs") {
                $list = Get-AnalysisJobList
                Send-JsonResponse -context $context -statusCode 200 -body $list
                continue
            }

            if ($method -eq "POST" -and $rawPath -eq "/api/analysis-jobs") {
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                $srcId      = 0
                $period     = "LAST 7 DAYS"
                $sourceName = ""
                try {
                    $payload = $bodyText | ConvertFrom-Json
                    if ($payload.source_id)   { $srcId      = [int]$payload.source_id }
                    if ($payload.period)      { $period     = [string]$payload.period }
                    if ($payload.source_name) { $sourceName = [string]$payload.source_name }
                } catch {}
                if ($srcId -le 0) {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = "source_id required" }
                    continue
                }
                $start = Start-AnalysisJob -LogSourceId $srcId -Period $period -SourceName $sourceName
                if ($start.rejected) {
                    Send-JsonResponse -context $context -statusCode 429 -body @{
                        error   = "max_concurrent"
                        running = $start.running
                        max     = $start.max
                    }
                } else {
                    Send-JsonResponse -context $context -statusCode 200 -body @{ id = $start.id; job = $start.job }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -match '^/api/analysis-jobs/([A-Za-z0-9\-]+)$') {
                $jobId = $Matches[1]
                $job   = Get-AnalysisJob -JobId $jobId
                if ($null -eq $job) {
                    Send-JsonResponse -context $context -statusCode 404 -body @{ error = "not found" }
                } else {
                    Send-JsonResponse -context $context -statusCode 200 -body $job
                }
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -match '^/api/analysis-jobs/([A-Za-z0-9\-]+)$') {
                $jobId = $Matches[1]
                $ok    = Remove-AnalysisJob -JobId $jobId
                Send-JsonResponse -context $context -statusCode 200 -body @{ success = $ok }
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/canvas/list") {
                $listJson = Get-CanvasListJson
                $lBytes   = [System.Text.Encoding]::UTF8.GetBytes($listJson)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.AddHeader("Cache-Control", "no-store")
                $context.Response.ContentLength64 = $lBytes.Length
                $context.Response.OutputStream.Write($lBytes, 0, $lBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "POST" -and $rawPath -eq "/api/canvas/rename") {
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                try {
                    $payload = $bodyText | ConvertFrom-Json
                    $from    = [string]$payload.from
                    $to      = [string]$payload.to
                    if ([string]::IsNullOrWhiteSpace($from)) { throw "from is required" }
                    if ([string]::IsNullOrWhiteSpace($to))   { throw "to is required" }
                    Rename-CanvasFile -From $from -To $to | Out-Null
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $true; name = (Get-CanvasSafeName -Name $to) }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/canvas") {
                $canvasName = Get-CanvasQueryName -Request $req
                $json    = Read-CanvasFile -Name $canvasName
                $cBytes  = [System.Text.Encoding]::UTF8.GetBytes($json)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.AddHeader("Cache-Control", "no-store")
                $context.Response.ContentLength64 = $cBytes.Length
                $context.Response.OutputStream.Write($cBytes, 0, $cBytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "PUT" -and $rawPath -eq "/api/canvas") {
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                try {
                    $canvasName = Get-CanvasQueryName -Request $req
                    Write-CanvasFile -Name $canvasName -Json $bodyText | Out-Null
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $true; name = (Get-CanvasSafeName -Name $canvasName) }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -eq "/api/canvas") {
                try {
                    $canvasName = Get-CanvasQueryName -Request $req
                    $ok = Remove-CanvasFile -Name $canvasName
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $ok }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/dashboards") {
                $list = Get-DashboardList
                Send-JsonResponse -context $context -statusCode 200 -body $list
                continue
            }

            if ($method -eq "POST" -and $rawPath -eq "/api/dashboards") {
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                try {
                    $payload     = $bodyText | ConvertFrom-Json
                    $filename    = [string]$payload.filename
                    $content     = [string]$payload.content
                    $description = [string]$payload.description
                    $author      = [string]$payload.author
                    if (-not $filename)    { throw "filename is required" }
                    if (-not $content)     { throw "content is required" }
                    if (-not $description) { throw "description is required" }
                    if (-not $author)      { throw "author is required" }
                    $entry = Save-Dashboard -Filename $filename -Content $content -Description $description -Author $author
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $true; entry = $entry }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -match '^/api/dashboards/file/(.+)$') {
                $fname = [System.Uri]::UnescapeDataString($Matches[1])
                try {
                    $content = Get-DashboardFileContent -Filename $fname
                    if ($null -eq $content) {
                        Send-JsonResponse -context $context -statusCode 404 -body @{ error = "Not found" }
                    } else {
                        $fBytes = [System.Text.Encoding]::UTF8.GetBytes($content)
                        $context.Response.StatusCode = 200
                        $context.Response.ContentType = "application/json"
                        $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                        $context.Response.AddHeader("Content-Disposition", "attachment; filename=`"$fname`"")
                        $context.Response.ContentLength64 = $fBytes.Length
                        $context.Response.OutputStream.Write($fBytes, 0, $fBytes.Length)
                        $context.Response.OutputStream.Close()
                    }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -match '^/api/dashboards/(.+)$') {
                $fname = [System.Uri]::UnescapeDataString($Matches[1])
                try {
                    $ok = Remove-Dashboard -Filename $fname
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $ok }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -match '^/api/tools/([A-Za-z0-9._-]+)/versions$') {
                $toolId = $Matches[1]
                try {
                    $json  = Get-ToolVersionsJson -Tool $toolId
                    $tBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $context.Response.StatusCode = 200
                    $context.Response.ContentType = "application/json"
                    $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                    $context.Response.ContentLength64 = $tBytes.Length
                    $context.Response.OutputStream.Write($tBytes, 0, $tBytes.Length)
                    $context.Response.OutputStream.Close()
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "POST" -and $rawPath -match '^/api/tools/([A-Za-z0-9._-]+)/versions$') {
                $toolId   = $Matches[1]
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                try {
                    $payload = $bodyText | ConvertFrom-Json
                    $rec = Add-ToolVersion -Tool $toolId `
                        -FileName ([string]$payload.file_name) `
                        -Author ([string]$payload.author) `
                        -Notes ([string]$payload.notes) `
                        -Version ([string]$payload.version) `
                        -ContentBase64 ([string]$payload.content_base64)
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $true; version = $rec.version }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -match '^/api/tools/([A-Za-z0-9._-]+)/download$') {
                $toolId  = $Matches[1]
                $version = ""
                if ($req.Url.Query -match 'version=([^&]+)') { $version = [System.Uri]::UnescapeDataString($Matches[1]) }
                try {
                    $info = Get-ToolVersionPath -Tool $toolId -Version $version
                    if (-not $info) {
                        Send-JsonResponse -context $context -statusCode 404 -body @{ error = "Not found" }
                    } else {
                        $fBytes = [System.IO.File]::ReadAllBytes($info.path)
                        $context.Response.StatusCode = 200
                        $context.Response.ContentType = "application/octet-stream"
                        $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                        $context.Response.AddHeader("Content-Disposition", "attachment; filename=`"$($info.file_name)`"")
                        $context.Response.ContentLength64 = $fBytes.Length
                        $context.Response.OutputStream.Write($fBytes, 0, $fBytes.Length)
                        $context.Response.OutputStream.Close()
                    }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -match '^/api/tools/([A-Za-z0-9._-]+)/versions/([A-Za-z0-9._-]+)$') {
                $toolId  = $Matches[1]
                $version = $Matches[2]
                try {
                    $ok = Remove-ToolVersion -Tool $toolId -Version $version
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $ok }
                } catch {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/eps-jobs") {
                $list = Get-EpsJobList
                Send-JsonResponse -context $context -statusCode 200 -body $list
                continue
            }

            if ($method -eq "POST" -and $rawPath -eq "/api/eps-jobs") {
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                $collector     = ""
                $collectorName = ""
                $sourceIds     = @()
                $period        = "LAST 1 HOURS"
                $startMs       = 0
                $endMs         = 0
                $windowLabel   = ""
                try {
                    $payload = $bodyText | ConvertFrom-Json
                    if ($payload.collector)      { $collector     = [string]$payload.collector }
                    if ($payload.collector_name) { $collectorName = [string]$payload.collector_name }
                    if ($payload.period)         { $period        = [string]$payload.period }
                    if ($payload.start_ms)       { $startMs       = [long]$payload.start_ms }
                    if ($payload.end_ms)         { $endMs         = [long]$payload.end_ms }
                    if ($payload.window_label)   { $windowLabel   = [string]$payload.window_label }
                    if ($payload.source_ids)     { $sourceIds     = @($payload.source_ids | ForEach-Object { [int]$_ }) }
                } catch {}
                if ($sourceIds.Count -eq 0) {
                    Send-JsonResponse -context $context -statusCode 400 -body @{ error = "source_ids required" }
                    continue
                }
                $start = Start-EpsJob -Collector $collector -CollectorName $collectorName -SourceIds $sourceIds -Period $period -StartMs $startMs -EndMs $endMs -WindowLabel $windowLabel
                if ($start.rejected) {
                    Send-JsonResponse -context $context -statusCode 429 -body @{
                        error   = "max_concurrent"
                        running = $start.running
                        max     = $start.max
                    }
                } else {
                    Send-JsonResponse -context $context -statusCode 200 -body @{ id = $start.id; job = $start.job }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -match '^/api/eps-jobs/([A-Za-z0-9\-]+)$') {
                $jobId = $Matches[1]
                $job   = Get-EpsJob -JobId $jobId
                if ($null -eq $job) {
                    Send-JsonResponse -context $context -statusCode 404 -body @{ error = "not found" }
                } else {
                    Send-JsonResponse -context $context -statusCode 200 -body $job
                }
                continue
            }

            if ($method -eq "DELETE" -and $rawPath -match '^/api/eps-jobs/([A-Za-z0-9\-]+)$') {
                $jobId = $Matches[1]
                $ok    = Remove-EpsJob -JobId $jobId
                Send-JsonResponse -context $context -statusCode 200 -body @{ success = $ok }
                continue
            }

            if ($method -eq "POST" -and $rawPath -match '^/api/source-analysis/(\d+)$') {
                $srcId  = [int]$Matches[1]
                $period = "LAST 7 DAYS"
                $q = $req.Url.Query
                if ($q -match 'period=([^&]+)') {
                    $period = [System.Uri]::UnescapeDataString($Matches[1])
                }
                try {
                    $analysis = Invoke-SourceAnalysis -LogSourceId $srcId -Period $period
                    Send-JsonResponse -context $context -statusCode 200 -body $analysis
                } catch {
                    Send-JsonResponse -context $context -statusCode 500 -body @{ error = [string]$_ }
                }
                continue
            }

            if ($method -eq "POST" -and $rawPath -match '^/api/reset-buckets/(\d+)$') {
                $srcId = [int]$Matches[1]
                try {
                    $info = Reset-SourceBuckets -LogSourceId $srcId
                    Send-JsonResponse -context $context -statusCode 200 -body @{ success = $true; file = $info.file }
                } catch {
                    Send-JsonResponse -context $context -statusCode 500 -body @{ error = [string]$_.Exception.Message }
                }
                continue
            }

            if ($method -eq "POST" -and $rawPath -match '^/api/source-analysis/(\d+)/overwrite$') {
                $srcId    = [int]$Matches[1]
                $reader   = New-Object System.IO.StreamReader($req.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                try {
                    $payload  = $bodyText | ConvertFrom-Json
                    $analysis = [ordered]@{
                        buckets       = $payload.buckets
                        daily_buckets = $payload.daily_buckets
                        analyzed_from = $payload.analyzed_from
                        analyzed_to   = $payload.analyzed_to
                        max_bucket    = $payload.max_bucket
                        stops         = @($payload.stops)
                    }
                    $writeInfo = Write-AnalysisOverwrite -LogSourceId $srcId -Analysis $analysis
                    Send-JsonResponse -context $context -statusCode 200 -body @{
                        success      = $true
                        file         = $writeInfo.file
                        total_gaps   = $writeInfo.total_gaps
                        stops_written = $writeInfo.stops_written
                    }
                } catch {
                    Send-JsonResponse -context $context -statusCode 500 -body @{ error = [string]$_; trace = [string]$_.ScriptStackTrace }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/state") {
                $stateFile = Join-Path $global:DataDir "state.json"
                if (Test-Path $stateFile) {
                    $stateBytes = [System.IO.File]::ReadAllBytes($stateFile)
                    $context.Response.StatusCode = 200
                    $context.Response.ContentType = "application/json"
                    $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                    $context.Response.AddHeader("Cache-Control", "no-store")
                    $context.Response.ContentLength64 = $stateBytes.Length
                    $context.Response.OutputStream.Write($stateBytes, 0, $stateBytes.Length)
                    $context.Response.OutputStream.Close()
                } else {
                    Send-JsonResponse -context $context -statusCode 200 -body @{ total_sources = 0 }
                }
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/alerts") {
                $alertsFile = Join-Path $global:DataDir "alerts.json"
                $json = "[]"
                if (Test-Path $alertsFile) {
                    try { $json = Get-Content $alertsFile -Raw } catch {}
                }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json"
                $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }

            if ($method -eq "GET" -and $rawPath -eq "/api/domain-files") {
                $files = @()
                if (Test-Path $global:DomainsDir) {
                    $files = Get-ChildItem -Path $global:DomainsDir -Filter "*.json" -Recurse |
                        ForEach-Object {
                            $rel = $_.FullName.Substring($WebRoot.Length).Replace('\', '/')
                            if (-not $rel.StartsWith('/')) { $rel = '/' + $rel }
                            $rel
                        }
                }
                Send-JsonResponse -context $context -statusCode 200 -body $files
                continue
            }

            if ($method -eq "GET") {
                $servePath = if ($rawPath -eq "/" -or $rawPath -eq "") {
                    Join-Path $WebRoot "templates\index.html"
                } else {
                    $decoded  = [System.Uri]::UnescapeDataString($rawPath)
                    $relative = $decoded.TrimStart('/').Replace('/', '\')
                    Join-Path $WebRoot $relative
                }

                $blockedExtensions = @(".cfg", ".ps1", ".psm1", ".psd1", ".bat", ".cmd", ".sh", ".env", ".ini", ".log")
                $blockedNames      = @("config.cfg", "main.ps1")
                $resolvedExt  = [System.IO.Path]::GetExtension($servePath).ToLower()
                $resolvedName = [System.IO.Path]::GetFileName($servePath).ToLower()
                $normalizedServe = [System.IO.Path]::GetFullPath($servePath)
                $normalizedRoot  = [System.IO.Path]::GetFullPath($WebRoot)
                $isOutsideRoot   = -not $normalizedServe.StartsWith($normalizedRoot)

                if ($isOutsideRoot -or ($blockedExtensions -contains $resolvedExt) -or ($blockedNames -contains $resolvedName)) {
                    $deny = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Forbidden"}')
                    $context.Response.StatusCode = 403
                    $context.Response.ContentType = "application/json"
                    $context.Response.AddHeader("Access-Control-Allow-Origin", "*")
                    $context.Response.ContentLength64 = $deny.Length
                    $context.Response.OutputStream.Write($deny, 0, $deny.Length)
                    $context.Response.OutputStream.Close()
                    continue
                }

                if (Test-Path $servePath -PathType Leaf) {
                    Send-FileResponse -context $context -filePath $servePath
                } else {
                    Send-JsonResponse -context $context -statusCode 404 -body @{
                        error    = "Not found"
                        path     = $rawPath
                        resolved = $servePath
                        webroot  = $WebRoot
                    }
                }
                continue
            }

            Send-JsonResponse -context $context -statusCode 405 -body @{ error = "Method not allowed" }

        } catch {
            $ex = $_.Exception
            $isClientAbort = $false
            while ($ex) {
                if ($ex -is [System.Net.HttpListenerException] -or
                    $ex -is [System.IO.IOException] -or
                    $ex -is [System.Net.Sockets.SocketException]) { $isClientAbort = $true; break }
                $ex = $ex.InnerException
            }
            if (-not $isClientAbort) {
                Write-Log "Listener error: $_" -Level WARN
            }
            try { $context.Response.OutputStream.Close() } catch {}
        }
    }

    $listener.Stop()
}