function Get-LogSources {
    $allSources = [System.Collections.Generic.List[object]]::new()
    $pageSize   = 200
    $start      = 0
    $uri        = "https://$($global:QRadarHost)/api/config/event_sources/log_source_management/log_sources?fields=id,name,type_id,group_ids,target_event_collector_id,last_event_time,average_eps,creation_date,enabled"

    while ($true) {
        $end     = $start + $pageSize - 1
        $request = [System.Net.HttpWebRequest]::Create($uri)
        $request.Method  = "GET"
        $request.Headers.Add("SEC", $global:AuthHeader["SEC"])
        $request.Headers.Add("Version", "14.0")
        $request.Accept  = "application/json"
        $request.AddRange("items", $start, $end)

        try {
            $response = $request.GetResponse()
            $reader   = New-Object System.IO.StreamReader($response.GetResponseStream())
            $json     = $reader.ReadToEnd()
            $reader.Close()
            $response.Close()
            $result = $json | ConvertFrom-Json
        } catch {
            Write-Warning "Get-LogSources page $start-$end failed: $_"
            break
        }

        if (-not $result -or $result.Count -eq 0) { break }

        foreach ($src in $result) {
            if ($src.enabled -eq $true) { $allSources.Add($src) }
        }

        if ($result.Count -lt $pageSize) { break }

        $start += $pageSize
    }

    return $allSources.ToArray()
}