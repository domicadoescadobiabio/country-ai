@echo off
rem Keeps the local brain running for weeks: if it stops (network drop, crash), it starts again after 15 s.
rem When its own code or .env.local-brain changes it exits with code 3 and starts again at once with the new code.
rem Put a shortcut to this file in the Startup folder (Win+R, shell:startup) so it also comes back after a reboot.
title COUNTRY AI - local brain (Qwen on Ollama)
cd /d "%~dp0.."
set LOCAL_BRAIN_SUPERVISED=1
:loop
echo [%date% %time%] starting the local brain
node scripts\local-brain.mjs
if %errorlevel%==3 goto reload
echo [%date% %time%] the local brain stopped, restarting in 15 seconds (close this window to stop it)
timeout /t 15 /nobreak >nul
goto loop
:reload
echo [%date% %time%] new code for the local brain, restarting now
timeout /t 2 /nobreak >nul
goto loop
