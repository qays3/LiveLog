if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -ArgumentList "-STA -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -NoNewWindow
    exit
}

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$global:LogDir  = Join-Path $rootDir "log"
$global:LogFile = Join-Path $global:LogDir "livelog.log"
if (-not (Test-Path $global:LogDir)) { New-Item -ItemType Directory -Path $global:LogDir | Out-Null }

$global:LogMutex = New-Object System.Threading.Mutex($false, "LiveLogFileMutex")

function Write-Log {
    param(
        [Parameter(Position = 0)][string]$Message,
        [ValidateSet("INFO", "WARN", "ERROR")][string]$Level = "INFO"
    )
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    $acquired = $false
    try {
        $acquired = $global:LogMutex.WaitOne(2000)
        Add-Content -Path $global:LogFile -Value $line -Encoding UTF8
    } catch {
    } finally {
        if ($acquired) { $global:LogMutex.ReleaseMutex() }
    }
}

function Read-Config {
    param([string]$path)
    $cfg = @{}
    $section = ""
    foreach ($line in Get-Content $path) {
        $line = $line.Trim()
        if ($line -match '^\[(.+)\]$') { $section = $Matches[1]; continue }
        if ($line -match '^([^=]+)=(.*)$') {
            $key = "$section.$($Matches[1].Trim())"
            $cfg[$key] = $Matches[2].Trim()
        }
    }
    return $cfg
}

$cfg = Read-Config (Join-Path $rootDir "config.cfg")

$global:QRadarHost      = $cfg["qradar.host"]
$global:QRadarToken     = $cfg["qradar.token"]
$global:VerifySSL       = $cfg["qradar.verify_ssl"] -ne "false"
$global:PollInterval    = [int]$cfg["polling.interval_sec"]
$global:HttpPort        = [int]$cfg["server.port"]
$global:BindHost        = if ($cfg["server.host"]) { $cfg["server.host"] } else { "0.0.0.0" }
$global:AppName         = if ($cfg["server.app_name"]) { $cfg["server.app_name"].Trim() } else { "LiveLog" }
$global:DataDir         = Join-Path $rootDir ($cfg["output.data_dir"]    -replace '^\./', '')
$global:DomainsDir      = Join-Path $rootDir ($cfg["output.domains_dir"] -replace '^\./', '')
$global:Timezone        = $cfg["locale.timezone"]
$global:DomainList      = $cfg["domains.list"] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$global:AlertBufferMin  = if ($cfg["alerts.buffer_minutes"]) { [int]$cfg["alerts.buffer_minutes"] } else { 0 }
$global:MaxBucketMinCount = if ($cfg["alerts.max_bucket_min_count"]) { [int]$cfg["alerts.max_bucket_min_count"] } else { 4 }
$global:MinAlertMinutes = if ($cfg["alerts.min_alert_minutes"]) { [int]$cfg["alerts.min_alert_minutes"] } else { 20 }
$global:AlertBreach     = $cfg["alerts.behavior_breach"]    -eq "true"
$global:AlertEps        = $cfg["alerts.eps_drop"]           -eq "true"
$global:AlertUndef      = $cfg["alerts.undefined_behavior"] -eq "true"
$global:BehaviorPattern = '^\d+\s*(M|H|D)$|^More than \d+\s*D$'

$global:IgnoreGroups       = if ($cfg["ignore_groups.list"])        { $cfg["ignore_groups.list"]        -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { @() }
$global:IgnoreTypes        = if ($cfg["ignore_types.list"])         { $cfg["ignore_types.list"]         -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { @() }
$global:IgnoreCollectors   = if ($cfg["ignore_collectors.list"])    { $cfg["ignore_collectors.list"]    -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { @() }
$global:IgnoreSourceIds    = if ($cfg["ignore_source_ids.list"])    { $cfg["ignore_source_ids.list"]    -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | ForEach-Object { [int]$_ } } else { @() }
$global:IgnoreNamePatterns = if ($cfg["ignore_name_patterns.list"]) { $cfg["ignore_name_patterns.list"] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { @() }

$global:CollectorDomainMap = @{}
foreach ($key in $cfg.Keys) {
    if ($key -match '^collector_domains\.(.+)$') {
        $collectorName = $Matches[1].Trim()
        $domainName    = $cfg[$key].Trim()
        $global:CollectorDomainMap[$collectorName] = $domainName
    }
}

$global:LastEventQueryTimeoutSec = 90
$global:LastEventOverlapMs       = 5000
$global:LastEventMap             = @{}
$global:LastEventQueryAt         = 0

if (-not $global:VerifySSL) {
    if (-not ([System.Management.Automation.PSTypeName]'TrustAll').Type) {
        Add-Type @"
            using System.Net;
            using System.Security.Cryptography.X509Certificates;
            public class TrustAll : ICertificatePolicy {
                public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
            }
"@
    }
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAll
}

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$global:AuthHeader = @{
    "SEC"           = $global:QRadarToken
    "Content-Type"  = "application/json"
    "Accept"        = "application/json"
    "Version"       = "14.0"
}

if (-not (Test-Path $global:DataDir))    { New-Item -ItemType Directory -Path $global:DataDir    | Out-Null }
if (-not (Test-Path $global:DomainsDir)) { New-Item -ItemType Directory -Path $global:DomainsDir | Out-Null }

$global:ToolsDashboardDir = Join-Path $rootDir "Tools\dashboard-pulse"
if (-not (Test-Path $global:ToolsDashboardDir)) { New-Item -ItemType Directory -Path $global:ToolsDashboardDir -Force | Out-Null }

$labelsFile = Join-Path $global:DataDir "labels.json"
if (-not (Test-Path $labelsFile)) { "{}" | Set-Content $labelsFile -Encoding UTF8 }

$portInUse = Get-NetTCPConnection -LocalPort $global:HttpPort -ErrorAction SilentlyContinue
if ($portInUse) {
    $portInUse | ForEach-Object {
        $ownerPid = [int]$_.OwningProcess
        if ($ownerPid -and $ownerPid -ne $PID) {
            Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
            Write-Log "Killed process $ownerPid holding port $($global:HttpPort)"
        }
    }
    Start-Sleep -Seconds 2
}

. (Join-Path $rootDir "api\Get-LogSources.ps1")
. (Join-Path $rootDir "api\Get-EventCollectors.ps1")
. (Join-Path $rootDir "api\Get-LogSourceGroups.ps1")
. (Join-Path $rootDir "api\Get-LogSourceTypes.ps1")
. (Join-Path $rootDir "api\Get-LogSourceDetails.ps1")
. (Join-Path $rootDir "api\Get-LastEvents.ps1")

function Invoke-BulkProtocolFetch {
    param([int[]]$SourceIds)
    if (-not $SourceIds -or $SourceIds.Count -eq 0) { return }

    $protocolTypeMap = @{0="Syslog";1="JDBC";2="Log File";3="OPSEC";4="SNMPv1";5="SNMPv2";6="SNMPv3";7="SDEE";12="WinCollect";14="MS Security Event Log";22="Office 365"}
    $pageSize = 100

    for ($i = 0; $i -lt $SourceIds.Count; $i += $pageSize) {
        $batch   = $SourceIds[$i..([math]::Min($i + $pageSize - 1, $SourceIds.Count - 1))]
        $filter  = "id in (" + ($batch -join ",") + ")"
        $encoded = [System.Uri]::EscapeDataString($filter)
        $uri     = "https://$($global:QRadarHost)/api/config/event_sources/log_source_management/log_sources?fields=id,protocol_type_id,protocol_parameters,status&filter=$encoded"

        try {
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
            $results = $json | ConvertFrom-Json

            foreach ($r in $results) {
                $pt  = if ($protocolTypeMap.ContainsKey([int]$r.protocol_type_id)) { $protocolTypeMap[[int]$r.protocol_type_id] } else { "Protocol-$($r.protocol_type_id)" }
                $idf = ""
                if ($r.protocol_parameters) {
                    $ip = $r.protocol_parameters | Where-Object { $_.name -eq "identifier" } | Select-Object -First 1
                    if ($ip) { $idf = [string]$ip.value }
                }
                $sState  = "NA"
                $sReason = ""
                if ($r.PSObject.Properties["status"] -and $r.status) {
                    $st = $r.status
                    if ($st.PSObject.Properties["status"] -and $st.status) { $sState = [string]$st.status }
                    if ($st.PSObject.Properties["messages"] -and $st.messages) {
                        $texts = @()
                        foreach ($m in @($st.messages)) {
                            if ($m.PSObject.Properties["text"] -and $m.text) { $texts += [string]$m.text }
                            elseif ($m -is [string]) { $texts += [string]$m }
                        }
                        $sReason = ($texts -join "; ")
                    }
                }
                $global:ProtocolCache[[int]$r.id] = @{ protocol_type = $pt; identifier = $idf; status_state = $sState; status_reason = $sReason }
            }
        } catch {
            Write-Log "Bulk protocol fetch failed for batch starting $($batch[0]): $_" -Level WARN
        }
    }
}
. (Join-Path $rootDir "api\Write-DomainJson.ps1")
. (Join-Path $rootDir "api\Invoke-SourceAnalysis.ps1")

$listenerRunspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
$listenerRunspace.ApartmentState = "STA"
$listenerRunspace.Open()

$listenerRunspace.SessionStateProxy.SetVariable("rootDir",                $rootDir)
$listenerRunspace.SessionStateProxy.SetVariable("globalQRadarHost",       $global:QRadarHost)
$listenerRunspace.SessionStateProxy.SetVariable("globalQRadarToken",      $global:QRadarToken)
$listenerRunspace.SessionStateProxy.SetVariable("globalAuthHeader",       $global:AuthHeader)
$listenerRunspace.SessionStateProxy.SetVariable("globalHttpPort",         $global:HttpPort)
$listenerRunspace.SessionStateProxy.SetVariable("globalAppName",          $global:AppName)
$listenerRunspace.SessionStateProxy.SetVariable("globalAlertBufferMin", $global:AlertBufferMin)
$listenerRunspace.SessionStateProxy.SetVariable("globalMaxBucketMinCount", $global:MaxBucketMinCount)
$listenerRunspace.SessionStateProxy.SetVariable("globalMinAlertMinutes", $global:MinAlertMinutes)
$listenerRunspace.SessionStateProxy.SetVariable("globalBindHost", $global:BindHost)
$listenerRunspace.SessionStateProxy.SetVariable("globalDataDir",          $global:DataDir)
$listenerRunspace.SessionStateProxy.SetVariable("globalDomainsDir",       $global:DomainsDir)
$listenerRunspace.SessionStateProxy.SetVariable("globalTimezone",         $global:Timezone)
$listenerRunspace.SessionStateProxy.SetVariable("globalDomainList",       $global:DomainList)
$listenerRunspace.SessionStateProxy.SetVariable("globalBehaviorPattern",  $global:BehaviorPattern)
$listenerRunspace.SessionStateProxy.SetVariable("globalVerifySSL",        $global:VerifySSL)
$listenerRunspace.SessionStateProxy.SetVariable("globalLogFile",          $global:LogFile)

$listenerPs = [System.Management.Automation.PowerShell]::Create()
$listenerPs.Runspace = $listenerRunspace

[void]$listenerPs.AddScript({
    $global:QRadarHost         = $globalQRadarHost
    $global:QRadarToken        = $globalQRadarToken
    $global:CollectorDomainMap = $globalCollectorDomainMap
    $global:AuthHeader         = $globalAuthHeader
    $global:HttpPort           = $globalHttpPort
    $global:AppName            = $globalAppName
    $global:DataDir            = $globalDataDir
    $global:AlertBufferMin     = if ($globalAlertBufferMin) { $globalAlertBufferMin } else { 0 }
    $global:MaxBucketMinCount = if ($globalMaxBucketMinCount) { $globalMaxBucketMinCount } else { 4 }
    $global:MinAlertMinutes = if ($globalMinAlertMinutes) { $globalMinAlertMinutes } else { 20 }
    $global:BindHost           = if ($globalBindHost) { $globalBindHost } else { "0.0.0.0" }
    $global:DomainsDir         = $globalDomainsDir
    $global:Timezone           = $globalTimezone
    $global:DomainList         = $globalDomainList
    $global:BehaviorPattern    = $globalBehaviorPattern
    $global:VerifySSL          = $globalVerifySSL
    $global:WebRoot            = $rootDir
    $global:LogFile            = $globalLogFile
    $global:LogMutex           = New-Object System.Threading.Mutex($false, "LiveLogFileMutex")

    function Write-Log {
        param(
            [Parameter(Position = 0)][string]$Message,
            [ValidateSet("INFO", "WARN", "ERROR")][string]$Level = "INFO"
        )
        $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
        $acquired = $false
        try {
            $acquired = $global:LogMutex.WaitOne(2000)
            Add-Content -Path $global:LogFile -Value $line -Encoding UTF8
        } catch {
        } finally {
            if ($acquired) { $global:LogMutex.ReleaseMutex() }
        }
    }

    . (Join-Path $rootDir "api\Invoke-SourceAnalysis.ps1")
    . (Join-Path $rootDir "api\Start-HttpListener.ps1")
    Start-HttpListener -WebRoot $rootDir
})

$listenerHandle = $listenerPs.BeginInvoke()

Start-Sleep -Seconds 2
if ($listenerPs.Streams.Error.Count -gt 0) {
    Write-Log "LISTENER ERRORS:" -Level ERROR
    $listenerPs.Streams.Error | ForEach-Object { Write-Log "  $_" -Level ERROR }
}
Write-Log "HTTP listener started on http://$($global:BindHost):$($global:HttpPort)/"
Write-Log "Polling QRadar every $($global:PollInterval)s..."

$global:LastEventQueryAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

while ($true) {
    try {
        if (-not $global:ProtocolCache) { $global:ProtocolCache = @{} }

        $logSources = Get-LogSources
        $collectors = Get-EventCollectors
        $groups     = Get-LogSourceGroups
        $types      = Get-LogSourceTypes

        $nowMs        = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $queryStartMs = [math]::Max([long]0, $global:LastEventQueryAt - $global:LastEventOverlapMs)
        try {
            $delta = Get-LastEvents -StartMs $queryStartMs -EndMs $nowMs
            foreach ($key in $delta.Keys) {
                if (-not $global:LastEventMap.ContainsKey($key) -or $delta[$key] -gt $global:LastEventMap[$key]) {
                    $global:LastEventMap[$key] = $delta[$key]
                }
            }
            $global:LastEventQueryAt = $nowMs
        } catch {
            Write-Log "LastEvent query failed: $_" -Level WARN
        }
        $logSources = Merge-LastEvents -LogSources $logSources -LastEventMap $global:LastEventMap

        $allIds = @($logSources | ForEach-Object { [int]$_.id })
        if ($allIds.Count -gt 0) {
            Invoke-BulkProtocolFetch -SourceIds $allIds
        }

        Write-DomainJson -LogSources $logSources -Collectors $collectors -Groups $groups -Types $types
    } catch {
        Write-Log "Poll cycle error: $_" -Level WARN
    }
    Start-Sleep -Seconds $global:PollInterval
}