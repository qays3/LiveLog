function Get-LogSourceGroups {
    $uri = "https://$($global:QRadarHost)/api/config/event_sources/log_source_management/log_source_groups?fields=id,name"
    $result = Invoke-RestMethod -Uri $uri -Headers $global:AuthHeader -Method Get
    $map = @{}
    $result | ForEach-Object { if ($_.id -ne $null) { $map[[int]$_.id] = $_.name } }
    return $map
}