function Initialize-EpsJobStore {
    if (-not $global:EpsJobs) {
        $global:EpsJobs = [System.Collections.Hashtable]::Synchronized(@{})
    }
    if ($null -eq $global:EpsJobSeq) {
        $global:EpsJobSeq = 0
    }
    if (-not $global:EpsMaxConcurrent) {
        $global:EpsMaxConcurrent = 3
    }
}

function Get-EpsRunningCount {
    Initialize-EpsJobStore
    $count = 0
    foreach ($key in @($global:EpsJobs.Keys)) {
        $job = $global:EpsJobs[$key]
        if ($job -and $job.status -eq "running") { $count++ }
    }
    return $count
}

function New-EpsJobId {
    Initialize-EpsJobStore
    $global:EpsJobSeq = $global:EpsJobSeq + 1
    return "eps-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())-$($global:EpsJobSeq)"
}

function ConvertTo-EpsJobView {
    param([hashtable]$Job)
    $view = [ordered]@{
        id             = $Job.id
        collector      = $Job.collector
        collector_name = $Job.collector_name
        period         = $Job.period
        window_label   = $Job.window_label
        status         = $Job.status
        created_ms     = $Job.created_ms
        finished_ms    = $Job.finished_ms
        error          = $Job.error
    }
    if ($Job.status -eq "done") { $view["result"] = $Job.result }
    return $view
}

function Start-EpsJob {
    param(
        [string]$Collector,
        [string]$CollectorName,
        [int[]]$SourceIds,
        [string]$Period,
        [long]$StartMs,
        [long]$EndMs,
        [string]$WindowLabel
    )

    Initialize-EpsJobStore

    if ((Get-EpsRunningCount) -ge $global:EpsMaxConcurrent) {
        return @{ rejected = $true; reason = "max_concurrent"; running = (Get-EpsRunningCount); max = $global:EpsMaxConcurrent }
    }

    $jobId = New-EpsJobId

    $record = [System.Collections.Hashtable]::Synchronized(@{
        id             = $jobId
        collector      = $Collector
        collector_name = $CollectorName
        period         = $Period
        window_label   = $WindowLabel
        status         = "running"
        result         = $null
        error          = $null
        created_ms     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        finished_ms    = $null
    })
    $global:EpsJobs[$jobId] = $record

    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
    $runspace.ApartmentState = "STA"
    $runspace.ThreadOptions  = "ReuseThread"
    $runspace.Open()

    $runspace.SessionStateProxy.SetVariable("jobRecord",     $record)
    $runspace.SessionStateProxy.SetVariable("jobRootDir",    $global:WebRoot)
    $runspace.SessionStateProxy.SetVariable("jobSourceIds",  $SourceIds)
    $runspace.SessionStateProxy.SetVariable("jobPeriod",     $Period)
    $runspace.SessionStateProxy.SetVariable("jobStartMs",    $StartMs)
    $runspace.SessionStateProxy.SetVariable("jobEndMs",      $EndMs)
    $runspace.SessionStateProxy.SetVariable("jobQRadarHost", $global:QRadarHost)
    $runspace.SessionStateProxy.SetVariable("jobAuthHeader", $global:AuthHeader)
    $runspace.SessionStateProxy.SetVariable("jobTimezone",   $global:Timezone)
    $runspace.SessionStateProxy.SetVariable("jobVerifySSL",  $global:VerifySSL)

    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace

    [void]$ps.AddScript({
        $global:QRadarHost = $jobQRadarHost
        $global:AuthHeader = $jobAuthHeader
        $global:Timezone   = $jobTimezone
        $global:WebRoot    = $jobRootDir

        try {
            if ($jobVerifySSL -eq $false) {
                try {
                    if (-not ([System.Management.Automation.PSTypeName]'TrustAllEps').Type) {
                        Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllEps : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
                    }
                    [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllEps
                } catch {}
            }
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

            . (Join-Path $jobRootDir "api\Invoke-EpsTest.ps1")

            $idArray = @($jobSourceIds | ForEach-Object { [int]$_ })
            $res = Invoke-EpsTest -SourceIds $idArray -Period $jobPeriod -StartMs $jobStartMs -EndMs $jobEndMs
            $jobRecord["result"]      = $res
            $jobRecord["status"]      = "done"
            $jobRecord["finished_ms"] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        } catch {
            $jobRecord["error"]       = [string]$_.Exception.Message
            $jobRecord["status"]      = "error"
            $jobRecord["finished_ms"] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        }
    })

    $handle = $ps.BeginInvoke()
    $record["_ps"]       = $ps
    $record["_handle"]   = $handle
    $record["_runspace"] = $runspace

    return @{ rejected = $false; id = $jobId; job = (ConvertTo-EpsJobView -Job $record) }
}

function Complete-EpsJobHandle {
    param([hashtable]$Job)
    if (-not $Job) { return }
    if ($Job.status -eq "running") { return }
    if (-not $Job["_handle"]) { return }
    try {
        if ($Job["_handle"].IsCompleted) {
            try { $Job["_ps"].EndInvoke($Job["_handle"]) } catch {}
            try { $Job["_ps"].Dispose() } catch {}
            try { $Job["_runspace"].Close() } catch {}
            try { $Job["_runspace"].Dispose() } catch {}
            $Job["_handle"]   = $null
            $Job["_ps"]       = $null
            $Job["_runspace"] = $null
        }
    } catch {}
}

function Get-EpsJobList {
    Initialize-EpsJobStore
    $list = @()
    foreach ($key in @($global:EpsJobs.Keys)) {
        $job = $global:EpsJobs[$key]
        if (-not $job) { continue }
        Complete-EpsJobHandle -Job $job
        $summary = [ordered]@{
            id             = $job.id
            collector      = $job.collector
            collector_name = $job.collector_name
            period         = $job.period
            window_label   = $job.window_label
            status         = $job.status
            created_ms     = $job.created_ms
            finished_ms    = $job.finished_ms
            error          = $job.error
        }
        $list += $summary
    }
    $list = @($list | Sort-Object -Property created_ms)
    return @{
        jobs    = $list
        running = (Get-EpsRunningCount)
        max     = $global:EpsMaxConcurrent
    }
}

function Get-EpsJob {
    param([string]$JobId)
    Initialize-EpsJobStore
    $job = $global:EpsJobs[$JobId]
    if (-not $job) { return $null }
    Complete-EpsJobHandle -Job $job
    return ConvertTo-EpsJobView -Job $job
}

function Remove-EpsJob {
    param([string]$JobId)
    Initialize-EpsJobStore
    $job = $global:EpsJobs[$JobId]
    if (-not $job) { return $false }
    try {
        if ($job["_ps"]) { try { $job["_ps"].Dispose() } catch {} }
        if ($job["_runspace"]) { try { $job["_runspace"].Close() } catch {}; try { $job["_runspace"].Dispose() } catch {} }
    } catch {}
    $global:EpsJobs.Remove($JobId)
    return $true
}