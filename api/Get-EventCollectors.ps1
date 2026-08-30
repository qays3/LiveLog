function Get-EventCollectors {
    $uri = "https://$($global:QRadarHost)/api/config/event_sources/event_collectors?fields=id,name"
    $result = Invoke-RestMethod -Uri $uri -Headers $global:AuthHeader -Method Get
    $map = @{}
    $result | ForEach-Object { if ($_.id -ne $null) { $map[[int]$_.id] = $_.name } }
    return $map
}