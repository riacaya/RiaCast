Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 256,256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
# background circle
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20,22,29))
$g.FillEllipse($bgBrush, 0,0,255,255)
# gradient ring
$rect = New-Object System.Drawing.Rectangle 40,40,176,176
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,90,60), 14)
$g.DrawEllipse($pen, 40,40,176,176)
# play triangle
$pts = @(
  [System.Drawing.PointF]::new(104,92),
  [System.Drawing.PointF]::new(172,128),
  [System.Drawing.PointF]::new(104,164)
)
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush([System.Drawing.PointF]::new(104,92),[System.Drawing.PointF]::new(172,164),[System.Drawing.Color]::FromArgb(255,90,60),[System.Drawing.Color]::FromArgb(255,154,60))
$g.FillPolygon($gradBrush, $pts)
# small accent dot
$dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,90,60))
$g.FillEllipse($dotBrush, 172,52,20,20)
$whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 3)
$g.DrawLine($whitePen, 182,56,182,68)
$g.DrawLine($whitePen, 176,62,188,62)
$g.Dispose()
$pngPath = "D:\RiaCast\windows-app\assets\logo-256.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
# ICO
$icoPath = "D:\RiaCast\windows-app\assets\riacast.ico"
$icoBmp = New-Object System.Drawing.Bitmap 64,64
$ig = [System.Drawing.Graphics]::FromImage($icoBmp)
$ig.SmoothingMode = 'AntiAlias'
$ig.InterpolationMode = 'HighQualityBicubic'
$ig.DrawImage($bmp,0,0,64,64)
$ig.Dispose()
$stream = [System.IO.File]::Create($icoPath)
$icon = [System.Drawing.Icon]::FromHandle($icoBmp.GetHicon())
$icon.Save($stream)
$stream.Close()
$icon.Dispose(); $icoBmp.Dispose(); $bmp.Dispose()
Write-Host "ok"
