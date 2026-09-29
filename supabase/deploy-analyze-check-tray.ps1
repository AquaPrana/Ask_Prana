# Deploy analyze-check-tray to project xeptedkydokgpmyjkmsh.
# Run once after: npx supabase login  (or set SUPABASE_ACCESS_TOKEN)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ProjectRef = "xeptedkydokgpmyjkmsh"
$FunctionName = "analyze-check-tray"

Write-Host "Deploying $FunctionName to $ProjectRef ..."
npx supabase functions deploy $FunctionName --project-ref $ProjectRef

Write-Host "`nVerifying OPTIONS preflight (expect HTTP 200) ..."
curl.exe -s -D - -o NUL -X OPTIONS "https://$ProjectRef.supabase.co/functions/v1/$FunctionName" `
  -H "Origin: http://localhost:8081" `
  -H "Access-Control-Request-Method: POST" `
  -H "Access-Control-Request-Headers: authorization,content-type,apikey,x-client-info"

Write-Host "`nIf status is 200, reload Expo Web and click Analyze Check Tray."
