$ErrorActionPreference = 'SilentlyContinue'
foreach ($p in 'signup','editor','routes','route','route-edit','notices','anotices','lab','privacy','weather-chart') {
  $w = (Get-Content "D:\OurTrail-ui\miniprogram\pages\$p\$p.wxml").Count
  $s = (Get-Content "D:\OurTrail-ui\miniprogram\pages\$p\$p.wxss").Count
  $j = (Get-Content "D:\OurTrail-ui\miniprogram\pages\$p\$p.js").Count
  Write-Output ("{0,-14} wxml={1,-5} wxss={2,-5} js={3}" -f $p, $w, $s, $j)
}
