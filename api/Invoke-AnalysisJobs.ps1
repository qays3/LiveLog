function Initialize-AnalysisJobStore {
    if (-not $global:AnalysisJobs) {
        $global:AnalysisJobs = [System.Collections.Hashtable]::Synchronized(@{})
    }
    if ($null -eq $global:AnalysisJobSeq) {
        $global:AnalysisJobSeq = 0
    }
    if (-not $global:AnalysisMaxConcurrent) {
        $global:AnalysisMaxConcurrent = 3
    }
}

function Get-AnalysisRunningCount {
    Initialize-AnalysisJobStore
    $count = 0
    foreach ($key in @($global:AnalysisJobs.Keys)) {
        $job = $global:AnalysisJobs[$key]
        if ($job -and $job.status -eq "running") { $count++ }
    }
    return $count
}

function New-AnalysisJobId {
    Initialize-AnalysisJobStore
    $global:AnalysisJobSeq = $global:AnalysisJobSeq + 1
    return "job-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())-$($global:AnalysisJobSeq)"
}

function Start-AnalysisJob {
    param([int]$LogSourceId, [string]$Period, [string]$SourceName)

    Initialize-AnalysisJobStore

    if ((Get-AnalysisRunningCount) -ge $global:AnalysisMaxConcurrent) {
        return @{ rejected = $true; reason = "max_concurrent"; running = (Get-AnalysisRunningCount); max = $global:AnalysisMaxConcurrent }
    }

    $jobId = New-AnalysisJobId

    $record = [System.Collections.Hashtable]::Synchronized(@{
        id          = $jobId
        source_id   = $LogSourceId
        source_name = $SourceName
        period      = $Period
        status      = "running"
        result      = $null
        error       = $null
        created_ms  = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        finished_ms = $null
    })
    $global:AnalysisJobs[$jobId] = $record

    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
    $runspace.ApartmentState = "STA"
    $runspace.ThreadOptions  = "ReuseThread"
    $runspace.Open()

    $runspace.SessionStateProxy.SetVariable("jobRecord",       $record)
    $runspace.SessionStateProxy.SetVariable("jobRootDir",      $global:WebRoot)
    $runspace.SessionStateProxy.SetVariable("jobSourceId",     $LogSourceId)
    $runspace.SessionStateProxy.SetVariable("jobPeriod",       $Period)
    $runspace.SessionStateProxy.SetVariable("jobQRadarHost",   $global:QRadarHost)
    $runspace.SessionStateProxy.SetVariable("jobQRadarToken",  $global:QRadarToken)
    $runspace.SessionStateProxy.SetVariable("jobAuthHeader",   $global:AuthHeader)
    $runspace.SessionStateProxy.SetVariable("jobTimezone",     $global:Timezone)
    $runspace.SessionStateProxy.SetVariable("jobMaxBucketMin", $global:MaxBucketMinCount)
    $runspace.SessionStateProxy.SetVariable("jobVerifySSL",    $global:VerifySSL)
    $runspace.SessionStateProxy.SetVariable("jobDataDir",      $global:DataDir)
    $runspace.SessionStateProxy.SetVariable("jobDomainsDir",   $global:DomainsDir)

    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace

    [void]$ps.AddScript({
        $global:QRadarHost        = $jobQRadarHost
        $global:QRadarToken       = $jobQRadarToken
        $global:AuthHeader        = $jobAuthHeader
        $global:Timezone          = $jobTimezone
        $global:MaxBucketMinCount = [int]$jobMaxBucketMin
        $global:WebRoot           = $jobRootDir
        $global:DataDir           = $jobDataDir
        $global:DomainsDir        = $jobDomainsDir

        try {
            if ($jobVerifySSL -eq $false) {
                try {
                    if (-not ([System.Management.Automation.PSTypeName]'TrustAllJob').Type) {
                        Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllJob : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
                    }
                    [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllJob
                } catch {}
            }
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

            . (Join-Path $jobRootDir "api\Invoke-SourceAnalysis.ps1")

            $analysis = Invoke-SourceAnalysis -LogSourceId $jobSourceId -Period $jobPeriod
            $jobRecord["result"]      = $analysis
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

    return @{ rejected = $false; id = $jobId; job = (ConvertTo-AnalysisJobView -Job $record) }
}

function ConvertTo-AnalysisJobView {
    param([hashtable]$Job)
    $view = [ordered]@{
        id          = $Job.id
        source_id   = $Job.source_id
        source_name = $Job.source_name
        period      = $Job.period
        status      = $Job.status
        created_ms  = $Job.created_ms
        finished_ms = $Job.finished_ms
        error       = $Job.error
    }
    if ($Job.status -eq "done") { $view["result"] = $Job.result }
    return $view
}

function Complete-AnalysisJobHandle {
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

function Get-AnalysisJobList {
    Initialize-AnalysisJobStore
    $list = @()
    foreach ($key in @($global:AnalysisJobs.Keys)) {
        $job = $global:AnalysisJobs[$key]
        if (-not $job) { continue }
        Complete-AnalysisJobHandle -Job $job
        $summary = [ordered]@{
            id          = $job.id
            source_id   = $job.source_id
            source_name = $job.source_name
            period      = $job.period
            status      = $job.status
            created_ms  = $job.created_ms
            finished_ms = $job.finished_ms
            error       = $job.error
        }
        $list += $summary
    }
    $list = @($list | Sort-Object -Property created_ms)
    return @{
        jobs    = $list
        running = (Get-AnalysisRunningCount)
        max     = $global:AnalysisMaxConcurrent
    }
}

function Get-AnalysisJob {
    param([string]$JobId)
    Initialize-AnalysisJobStore
    $job = $global:AnalysisJobs[$JobId]
    if (-not $job) { return $null }
    Complete-AnalysisJobHandle -Job $job
    return ConvertTo-AnalysisJobView -Job $job
}

function Remove-AnalysisJob {
    param([string]$JobId)
    Initialize-AnalysisJobStore
    $job = $global:AnalysisJobs[$JobId]
    if (-not $job) { return $false }
    try {
        if ($job["_ps"]) { try { $job["_ps"].Dispose() } catch {} }
        if ($job["_runspace"]) { try { $job["_runspace"].Close() } catch {}; try { $job["_runspace"].Dispose() } catch {} }
    } catch {}
    $global:AnalysisJobs.Remove($JobId)
    return $true
}