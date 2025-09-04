@echo off
echo ===============================================================
echo LAKESIDE RETREAT - QUICK SECRET GENERATOR
echo ===============================================================
echo.

echo GENERATING PRODUCTION SECRETS...
echo.

echo 1. JWT_SECRET (64 characters):
powershell -command "[System.Web.Security.Membership]::GeneratePassword(64, 10) -replace '[\W]', ([char](Get-Random -Min 97 -Max 122))"
echo.

echo 2. SESSION_SECRET (64 characters):
powershell -command "[System.Web.Security.Membership]::GeneratePassword(64, 10) -replace '[\W]', ([char](Get-Random -Min 97 -Max 122))"
echo.

echo 3. ADMIN_USERNAME:
echo    Suggested: admin_%random%
echo.

echo 4. STRONG PASSWORD (16 characters):
powershell -command "Add-Type -AssemblyName System.Web; [System.Web.Security.Membership]::GeneratePassword(16, 4)"
echo.

echo 5. UPLISTING_WEBHOOK_SECRET:
powershell -command "[System.Web.Security.Membership]::GeneratePassword(64, 10) -replace '[\W]', ([char](Get-Random -Min 97 -Max 122))"
echo.

echo 6. DATABASE_ENCRYPTION_KEY:
powershell -command "[System.Web.Security.Membership]::GeneratePassword(64, 10) -replace '[\W]', ([char](Get-Random -Min 97 -Max 122))"
echo.

echo ===============================================================
echo IMPORTANT: Copy these values to your Render.com environment
echo ===============================================================
echo.
echo To generate bcrypt hash for password:
echo 1. Install bcryptjs: npm install bcryptjs
echo 2. Run: node generate-secrets.js
echo.
pause