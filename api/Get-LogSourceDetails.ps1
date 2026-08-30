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

function Get-LogSourceDetails {
    param([int]$LogSourceId)
    try {
        $uri     = "https://$($global:QRadarHost)/api/config/event_sources/log_source_management/log_sources/$LogSourceId"
        $request = [System.Net.HttpWebRequest]::Create($uri)
        $request.Method  = "GET"
        $request.Headers.Add("SEC", $global:AuthHeader["SEC"])
        $request.Headers.Add("Version", "14.0")
        $request.Accept  = "application/json"

        $response = $request.GetResponse()
        $reader   = New-Object System.IO.StreamReader($response.GetResponseStream())
        $json     = $reader.ReadToEnd()
        $reader.Close()
        $response.Close()
        $resp = $json | ConvertFrom-Json

        $protocolTypeMap = @{
            0  = "Syslog"
            1  = "JDBC"
            2  = "Log File"
            3  = "OPSEC"
            4  = "SNMPv1"
            5  = "SNMPv2"
            6  = "SNMPv3"
            7  = "SDEE"
            12 = "WinCollect"
            14 = "MS Security Event Log"
            22 = "Office 365"
        }

        $protocolType = if ($protocolTypeMap.ContainsKey([int]$resp.protocol_type_id)) {
            $protocolTypeMap[[int]$resp.protocol_type_id]
        } else {
            "Protocol-$($resp.protocol_type_id)"
        }

        $identifier = ""
        if ($resp.protocol_parameters) {
            $identParam = $resp.protocol_parameters | Where-Object { $_.name -eq "identifier" } | Select-Object -First 1
            if ($identParam) { $identifier = [string]$identParam.value }
        }

        $statusState  = "NA"
        $statusReason = ""
        if ($resp.PSObject.Properties["status"] -and $resp.status) {
            $st = $resp.status
            if ($st.PSObject.Properties["status"] -and $st.status) {
                $statusState = [string]$st.status
            }
            if ($st.PSObject.Properties["messages"] -and $st.messages) {
                $texts = @()
                foreach ($m in @($st.messages)) {
                    if ($m.PSObject.Properties["text"] -and $m.text) { $texts += [string]$m.text }
                    elseif ($m -is [string]) { $texts += [string]$m }
                }
                $statusReason = ($texts -join "; ")
            }
        }

        return @{
            protocol_type = $protocolType
            identifier    = $identifier
            status_state  = $statusState
            status_reason = $statusReason
        }
    } catch {
        Write-Log "Get-LogSourceDetails failed for id=$LogSourceId : $_" -Level WARN
        return @{ protocol_type = ""; identifier = ""; status_state = "NA"; status_reason = "" }
    }
}